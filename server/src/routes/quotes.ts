import { Router } from 'express';
import {
  QuoteEngine,
  JobberIntegration,
  QuoteDraftService,
  ActivityLogService,
  EmbeddingService,
  SimilarityEngine,
  QuoteSyncService,
  RevisionEngine,
  JobberWebSession,
  JobberWebhookService,
} from '../services/index.js';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import { query } from '../config/database.js';
import type { ProductCatalogEntry, QuoteTemplate, JobberCustomerRequest } from 'shared';

const router = Router();
const activityLog = new ActivityLogService();
const jobberIntegration = new JobberIntegration(activityLog);
const quoteEngine = new QuoteEngine();
const quoteDraftService = new QuoteDraftService();
const revisionEngine = new RevisionEngine();
const jobberWebSession = new JobberWebSession();
const embeddingService = new EmbeddingService();
const similarityEngine = new SimilarityEngine(embeddingService);
const quoteSyncService = new QuoteSyncService(embeddingService, activityLog);
const webhookService = new JobberWebhookService(activityLog);

// All quote routes require authentication
router.use(sessionMiddleware);

/**
 * POST /corpus/sync
 * Trigger a manual corpus synchronization with Jobber.
 */
router.post('/corpus/sync', async (_req, res, next) => {
  try {
    const result = await quoteSyncService.sync();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /corpus/status
 * Get the current corpus status (quote count and last sync timestamp).
 */
router.get('/corpus/status', async (_req, res, next) => {
  try {
    const status = await quoteSyncService.getStatus();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /generate
 * Submit a customer request and generate a quote draft.
 */
router.post('/generate', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { customerText, mediaItemIds, catalogSource, manualCatalog, manualTemplates, jobberRequestId } = req.body as {
      customerText?: string;
      mediaItemIds?: string[];
      catalogSource?: 'jobber' | 'manual';
      manualCatalog?: ProductCatalogEntry[];
      manualTemplates?: QuoteTemplate[];
      jobberRequestId?: string;
    };

    if (!customerText && (!mediaItemIds || mediaItemIds.length === 0)) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'generate',
        description: 'Please provide customer request text or at least one image.',
        recommendedActions: ['Enter customer text or upload images'],
      });
    }

    const source = catalogSource ?? (jobberIntegration.isAvailable() ? 'jobber' : 'manual');

    let catalog: ProductCatalogEntry[];
    let templates: QuoteTemplate[];

    if (source === 'jobber') {
      [catalog, templates] = await Promise.all([
        jobberIntegration.fetchProductCatalog(),
        jobberIntegration.fetchTemplateLibrary(),
      ]);
      // If Jobber failed during fetch, fall back to manual
      if (!jobberIntegration.isAvailable()) {
        catalog = manualCatalog ?? await fetchManualCatalog(userId);
        templates = manualTemplates ?? await fetchManualTemplates(userId);
      }
    } else {
      catalog = manualCatalog ?? await fetchManualCatalog(userId);
      templates = manualTemplates ?? await fetchManualTemplates(userId);
    }

    // Find similar past quotes from the corpus
    let similarQuotes;
    try {
      similarQuotes = await similarityEngine.findSimilar(customerText ?? '');
    } catch {
      // Graceful degradation: proceed without similar quotes
      similarQuotes = [];
    }

    const result = await quoteEngine.generateQuote(
      {
        customerText: customerText ?? '',
        mediaItemIds: mediaItemIds ?? [],
        userId,
        catalogSource: source,
        manualCatalog: source === 'manual' ? catalog : undefined,
        manualTemplates: source === 'manual' ? templates : undefined,
        similarQuotes: similarQuotes.map((sq) => ({
          jobberQuoteId: sq.jobberQuoteId,
          quoteNumber: sq.quoteNumber,
          title: sq.title,
          message: sq.message,
          similarityScore: sq.similarityScore,
        })),
      },
      catalog,
      templates,
    );

    // Persist the draft
    if (jobberRequestId) {
      result.draft.jobberRequestId = jobberRequestId;
    }
    const saved = await quoteDraftService.save(result.draft);
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /drafts
 * List saved quote drafts for the authenticated user.
 */
router.get('/drafts', async (req, res, next) => {
  try {
    const drafts = await quoteDraftService.list(req.user!.id);
    res.json({ drafts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /drafts/:id
 * Get a single quote draft by ID.
 */
router.get('/drafts/:id', async (req, res, next) => {
  try {
    const draft = await quoteDraftService.getById(req.params.id, req.user!.id);
    res.json(draft);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /drafts/:id
 * Update a quote draft (edit line items, resolve items, change status).
 */
router.put('/drafts/:id', async (req, res, next) => {
  try {
    const { lineItems, unresolvedItems, selectedTemplateId, status } = req.body;
    const draft = await quoteDraftService.update(req.params.id, req.user!.id, {
      lineItems,
      unresolvedItems,
      selectedTemplateId,
      status,
    });
    res.json(draft);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /drafts/:id/revise
 * Submit feedback and get a revised draft.
 */
router.post('/drafts/:id/revise', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const draftId = req.params.id;
    const { feedbackText } = req.body as { feedbackText?: string };

    const trimmed = (feedbackText ?? '').trim();
    if (!trimmed) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'revise',
        description: 'Feedback text cannot be empty.',
        recommendedActions: ['Enter feedback describing the changes you want'],
      });
    }

    // Load the current draft (verifies ownership)
    const draft = await quoteDraftService.getById(draftId, userId);

    // Fetch the product catalog (same logic as generate route)
    let catalog: ProductCatalogEntry[];
    if (draft.catalogSource === 'jobber' && jobberIntegration.isAvailable()) {
      catalog = await jobberIntegration.fetchProductCatalog();
      if (!jobberIntegration.isAvailable()) {
        catalog = await fetchManualCatalog(userId);
      }
    } else {
      catalog = await fetchManualCatalog(userId);
    }

    // If catalog is empty, try imported products
    if (catalog.length === 0) {
      const imported = await query(
        'SELECT id, name, description, category, unit_price FROM jobber_products WHERE active = true ORDER BY name',
      );
      catalog = imported.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        unitPrice: Number(row.unit_price),
        description: (row.description as string) ?? '',
        category: (row.category as string) ?? undefined,
        source: 'jobber' as const,
      }));
    }

    // Revise the draft
    const revised = await revisionEngine.revise({
      feedbackText: trimmed,
      currentLineItems: draft.lineItems,
      currentUnresolvedItems: draft.unresolvedItems,
      catalog,
    });

    // Persist the revision history entry
    await quoteDraftService.addRevisionEntry(draftId, userId, trimmed);

    // Update the draft with revised line items
    const updated = await quoteDraftService.update(draftId, userId, {
      lineItems: revised.lineItems,
      unresolvedItems: revised.unresolvedItems,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /drafts/:id
 * Delete a quote draft.
 */
router.delete('/drafts/:id', async (req, res, next) => {
  try {
    await quoteDraftService.delete(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /catalog
 * Get the current product catalog (from Jobber or manual entries).
 */
router.get('/catalog', async (req, res, next) => {
  try {
    let catalog: ProductCatalogEntry[] = [];
    if (jobberIntegration.isAvailable()) {
      catalog = await jobberIntegration.fetchProductCatalog();
    }
    // Always fall back to imported products if we got nothing
    if (catalog.length === 0) {
      const imported = await query(
        'SELECT id, name, description, category, unit_price FROM jobber_products WHERE active = true ORDER BY name',
      );
      catalog = imported.rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        unitPrice: Number(row.unit_price),
        description: (row.description as string) ?? '',
        category: (row.category as string) ?? undefined,
        source: 'jobber' as const,
      }));
    }
    // Last resort: manual entries
    if (catalog.length === 0) {
      catalog = await fetchManualCatalog(req.user!.id);
    }
    res.json({ catalog });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /catalog
 * Save manual catalog entries (for fallback mode).
 */
router.post('/catalog', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const entries = req.body.entries as Array<{ name: string; unitPrice: number; description?: string; category?: string }>;

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'saveCatalog',
        description: 'Please provide at least one catalog entry.',
        recommendedActions: ['Add product entries with name and unit price'],
      });
    }

    // Clear existing manual entries for this user and insert new ones
    await query('DELETE FROM manual_catalog_entries WHERE user_id = $1', [userId]);

    for (const entry of entries) {
      await query(
        `INSERT INTO manual_catalog_entries (id, user_id, name, unit_price, description, category)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [userId, entry.name, entry.unitPrice, entry.description ?? null, entry.category ?? null],
      );
    }

    const catalog = await fetchManualCatalog(userId);
    res.json({ catalog });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /templates
 * Get the current template library (from Jobber or manual entries).
 */
router.get('/templates', async (req, res, next) => {
  try {
    const templates = await fetchManualTemplates(req.user!.id);
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /templates
 * Save manual template entries (for fallback mode).
 */
router.post('/templates', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const entries = req.body.entries as Array<{ name: string; content: string; category?: string }>;

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'saveTemplates',
        description: 'Please provide at least one template entry.',
        recommendedActions: ['Add template entries with name and content'],
      });
    }

    // Clear existing manual templates for this user and insert new ones
    await query('DELETE FROM manual_templates WHERE user_id = $1', [userId]);

    for (const entry of entries) {
      await query(
        `INSERT INTO manual_templates (id, user_id, name, content, category)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [userId, entry.name, entry.content, entry.category ?? null],
      );
    }

    const templates = await fetchManualTemplates(userId);
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobber/requests
 * Fetch customer requests from Jobber API, enriched with any webhook data.
 */
router.get('/jobber/requests', async (_req, res, next) => {
  try {
    let requests: JobberCustomerRequest[] = [];
    let available = false;

    if (jobberIntegration.isAvailable()) {
      requests = await jobberIntegration.fetchCustomerRequests();
      available = jobberIntegration.isAvailable();
    }

    // Merge in webhook data — enriches API results with fuller detail
    // and adds any requests that came in via webhook but aren't in the API page
    try {
      const webhookRequests = await webhookService.getWebhookRequests();
      const apiIds = new Set(requests.map((r) => r.id));

      for (const wr of webhookRequests) {
        if (apiIds.has(wr.id)) {
          // Enrich existing API request with webhook data
          const existing = requests.find((r) => r.id === wr.id)!;
          if (wr.imageUrls.length > existing.imageUrls.length) {
            existing.imageUrls = wr.imageUrls;
          }
          if (wr.description && (!existing.description || existing.description.length < wr.description.length)) {
            existing.description = wr.description;
          }
          if (wr.structuredNotes.length > existing.structuredNotes.length) {
            existing.structuredNotes = wr.structuredNotes;
            existing.notes = wr.structuredNotes.map((n) => n.message);
          }
        } else {
          // Add webhook-only request
          requests.push(wr);
        }
      }

      // Re-sort by date descending
      requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (webhookRequests.length > 0) available = true;
    } catch {
      // Webhook enrichment is best-effort
    }

    res.json({ requests, available });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobber/requests/:id/form-data
 * Fetch the form submission data for a specific Jobber request.
 * This uses the internal Jobber API (requires web credentials).
 */
router.get('/jobber/requests/:id/form-data', async (req, res, next) => {
  try {
    if (!jobberWebSession.isConfigured()) {
      res.json({ formData: null });
      return;
    }
    const formData = await jobberWebSession.fetchRequestFormData(req.params.id);
    res.json({ formData });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /jobber/backfill
 * One-time backfill: fetch all existing requests from Jobber API
 * and store full details in the webhook table.
 */
router.post('/jobber/backfill', async (_req, res, next) => {
  try {
    // Direct API call to fetch requests with full details (bypasses rate-heavy pagination)
    const accessToken = process.env.JOBBER_ACCESS_TOKEN;
    if (!accessToken) {
      res.json({ message: 'No Jobber access token configured', processed: 0, failed: 0 });
      return;
    }

    let processed = 0;
    let failed = 0;
    let total = 0;
    let after: string | null = null;
    let hasMore = true;

    while (hasMore) {
      const apiRes = await fetch('https://api.getjobber.com/api/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-JOBBER-GRAPHQL-VERSION': '2025-04-16',
        },
        body: JSON.stringify({
          query: `query($first: Int!, $after: String) {
            requests(first: $first, after: $after) {
              edges { node {
                id title companyName contactName requestStatus createdAt jobberWebUri
                client { id firstName lastName companyName }
                notes(first: 20) { edges { node { ... on RequestNote { message createdAt createdBy { __typename } } } } }
                noteAttachments(first: 20) { edges { node { url fileName contentType } } }
              } }
              pageInfo { hasNextPage endCursor }
            }
          }`,
          variables: { first: 25, after },
        }),
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        console.error('Backfill API error:', apiRes.status, errText.substring(0, 500));
        failed++; break;
      }
      const json = await apiRes.json() as Record<string, unknown>;
      if ((json as any).errors) {
        console.error('Backfill GraphQL errors:', JSON.stringify((json as any).errors).substring(0, 500));
        failed++; break;
      }
      const data = json.data as Record<string, unknown> | undefined;
      const requests = data?.requests as { edges: Array<{ node: Record<string, unknown> }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } | undefined;
      const edges = requests?.edges ?? [];
      const pageInfo = requests?.pageInfo ?? { hasNextPage: false, endCursor: null };

      for (const edge of edges) {
        total++;
        const node = edge.node as Record<string, unknown>;
        try {
          const existing = await query(
            'SELECT id FROM jobber_webhook_requests WHERE jobber_request_id = $1 AND processed_at IS NOT NULL LIMIT 1',
            [node.id],
          );
          if (existing.rows.length > 0) { processed++; continue; }

          const noteEdges = ((node.notes as Record<string, unknown>)?.edges as Array<{ node: Record<string, unknown> }>) ?? [];
          const attachEdges = ((node.noteAttachments as Record<string, unknown>)?.edges as Array<{ node: Record<string, unknown> }>) ?? [];
          const imageUrls = attachEdges
            .filter((e) => (e.node.contentType as string).startsWith('image/'))
            .map((e) => e.node.url as string);
          const description = noteEdges
            .map((e) => e.node?.message as string | undefined)
            .filter((m): m is string => !!m)
            .join('\n\n');

          const clientObj = node.client as Record<string, unknown> | null | undefined;
          const clientName = (node.companyName as string)
            || (node.contactName as string)
            || (clientObj ? `${clientObj.firstName || ''} ${clientObj.lastName || ''}`.trim() : null)
            || (clientObj?.companyName as string)
            || null;

          await query(
            `INSERT INTO jobber_webhook_requests
              (jobber_request_id, topic, account_id, title, client_name, description, request_body, image_urls, raw_payload, processed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
              node.id,
              'BACKFILL',
              '',
              node.title ?? null,
              clientName,
              description,
              JSON.stringify(node),
              JSON.stringify(imageUrls),
              JSON.stringify({ backfill: true }),
            ],
          );
          processed++;
        } catch {
          failed++;
        }
      }

      hasMore = pageInfo.hasNextPage && !!pageInfo.endCursor;
      after = pageInfo.endCursor;
    }

    res.json({ message: 'Backfill complete', total, processed, failed });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /jobber/session-cookies
 * Set Jobber web session cookies manually (from browser DevTools).
 * This enables form data fetching without automated Auth0 login.
 */
router.post('/jobber/session-cookies', (req, res) => {
  const { cookies } = req.body as { cookies?: string };
  if (!cookies || typeof cookies !== 'string') {
    res.status(400).json({ error: 'Please provide a cookies string' });
    return;
  }
  jobberWebSession.setManualCookies(cookies);
  res.json({ success: true, message: 'Session cookies set' });
});

/**
 * GET /jobber/session-cookies/status
 * Check if Jobber web session cookies are configured.
 */
router.get('/jobber/session-cookies/status', (_req, res) => {
  res.json(jobberWebSession.getManualCookiesStatus());
});

/**
 * GET /jobber/status
 * Check Jobber API availability and webhook status.
 */
router.get('/jobber/status', async (_req, res) => {
  let webhookActive = false;
  try {
    const result = await query(
      `SELECT COUNT(*) as count FROM jobber_webhook_requests`,
    );
    webhookActive = Number(result.rows[0]?.count) > 0;
  } catch { /* table may not exist yet */ }

  res.json({
    available: jobberIntegration.isAvailable() || webhookActive,
    webhookActive,
  });
});

// ── Helper functions ──────────────────────────────────────────

async function fetchManualCatalog(userId: string): Promise<ProductCatalogEntry[]> {
  const result = await query(
    'SELECT id, name, unit_price, description, category FROM manual_catalog_entries WHERE user_id = $1 ORDER BY created_at ASC',
    [userId],
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    unitPrice: Number(row.unit_price),
    description: (row.description as string) ?? '',
    category: (row.category as string) ?? undefined,
    source: 'manual' as const,
  }));
}

async function fetchManualTemplates(userId: string): Promise<QuoteTemplate[]> {
  const result = await query(
    'SELECT id, name, content, category FROM manual_templates WHERE user_id = $1 ORDER BY created_at ASC',
    [userId],
  );
  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    content: row.content as string,
    category: (row.category as string) ?? undefined,
    source: 'manual' as const,
  }));
}

export default router;
