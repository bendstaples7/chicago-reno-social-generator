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
  RulesService,
  JobberTokenStore,
} from '../services/index.js';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import { query } from '../config/database.js';
import type { SimilarQuoteResult } from '../services/index.js';
import type { ProductCatalogEntry, QuoteTemplate, JobberCustomerRequest, RuleGroupWithRules } from 'shared';

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
const rulesService = new RulesService();

// All quote routes require authentication
router.use(sessionMiddleware);

// ── Rules CRUD endpoints ──────────────────────────────────────

/**
 * GET /rules
 * List all rule groups with their nested rules.
 */
router.get('/rules', async (_req, res, next) => {
  try {
    const groups = await rulesService.getAllGroupedRules();
    res.json(groups);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /rules
 * Create a new rule.
 */
router.post('/rules', async (req, res, next) => {
  try {
    const { name, description, ruleGroupId, isActive } = req.body as {
      name?: string;
      description?: string;
      ruleGroupId?: string;
      isActive?: boolean;
    };
    const rule = await rulesService.createRule({
      name: name ?? '',
      description: description ?? '',
      ruleGroupId,
      isActive,
    });
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /rules/:id
 * Update an existing rule.
 */
router.put('/rules/:id', async (req, res, next) => {
  try {
    const { name, description, ruleGroupId, isActive } = req.body as {
      name?: string;
      description?: string;
      ruleGroupId?: string;
      isActive?: boolean;
    };
    const rule = await rulesService.updateRule(req.params.id, {
      name,
      description,
      ruleGroupId,
      isActive,
    });
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /rules/:id/deactivate
 * Deactivate a rule (soft delete).
 */
router.put('/rules/:id/deactivate', async (req, res, next) => {
  try {
    const rule = await rulesService.deactivateRule(req.params.id);
    res.json(rule);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /rules/groups
 * Create a new rule group.
 */
router.post('/rules/groups', async (req, res, next) => {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    const group = await rulesService.createGroup({
      name: name ?? '',
      description,
    });
    res.status(201).json(group);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /rules/groups/:id
 * Update an existing rule group.
 */
router.put('/rules/groups/:id', async (req, res, next) => {
  try {
    const { name, description, displayOrder } = req.body as {
      name?: string;
      description?: string;
      displayOrder?: number;
    };
    const group = await rulesService.updateGroup(req.params.id, {
      name,
      description,
      displayOrder,
    });
    res.json(group);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /rules/groups/:id
 * Delete a rule group (reassigns its rules to the "General" group).
 */
router.delete('/rules/groups/:id', async (req, res, next) => {
  try {
    await rulesService.deleteGroup(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

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
    let similarQuotes: SimilarQuoteResult[] = [];
    try {
      similarQuotes = await similarityEngine.findSimilar(customerText ?? '');
    } catch {
      // Graceful degradation: proceed without similar quotes
      similarQuotes = [];
    }

    // Fetch active rules for prompt injection
    let activeRules: RuleGroupWithRules[] = [];
    try {
      activeRules = await rulesService.getActiveRulesGrouped();
    } catch {
      // Graceful degradation: proceed without rules
      activeRules = [];
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
      activeRules,
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
    const { feedbackText, createRule: shouldCreateRule } = req.body as {
      feedbackText?: string;
      createRule?: boolean;
    };

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

    // Fetch active rules for prompt injection
    let activeRules: RuleGroupWithRules[] = [];
    try {
      activeRules = await rulesService.getActiveRulesGrouped();
    } catch {
      activeRules = [];
    }

    // Revise the draft with rules
    const revised = await revisionEngine.revise({
      feedbackText: trimmed,
      currentLineItems: draft.lineItems,
      currentUnresolvedItems: draft.unresolvedItems,
      catalog,
      rules: activeRules,
    });

    // Persist the revision history entry
    await quoteDraftService.addRevisionEntry(draftId, userId, trimmed);

    // Update the draft with revised line items
    const updated = await quoteDraftService.update(draftId, userId, {
      lineItems: revised.lineItems,
      unresolvedItems: revised.unresolvedItems,
    });

    // Optionally create a rule from the feedback text
    let ruleCreated: { id: string; name: string } | undefined;
    let ruleCreationError: string | undefined;
    if (shouldCreateRule) {
      try {
        const newRule = await rulesService.createRuleFromFeedback(trimmed);
        ruleCreated = { id: newRule.id, name: newRule.name };
      } catch (ruleErr) {
        ruleCreationError = ruleErr instanceof PlatformError
          ? ruleErr.description
          : ruleErr instanceof Error
            ? ruleErr.message
            : 'Unknown error creating rule';
      }
    }

    res.json({
      ...updated,
      ...(ruleCreated ? { ruleCreated } : {}),
      ...(ruleCreationError ? { ruleCreationError } : {}),
    });
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
    const client = await (await import('../config/database.js')).getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM manual_catalog_entries WHERE user_id = $1', [userId]);

      for (const entry of entries) {
        await client.query(
          `INSERT INTO manual_catalog_entries (id, user_id, name, unit_price, description, category)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
          [userId, entry.name, entry.unitPrice, entry.description ?? null, entry.category ?? null],
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
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

    // Fire-and-forget background enrichment for incomplete requests.
    // Identify requests missing detailed data and fetch from the Jobber public API.
    const incompleteRequests = requests.filter((r) => {
      const hasDescription = r.description && r.description.trim().length > 0;
      const hasNotes = (r.notes && r.notes.length > 0) || (r.structuredNotes && r.structuredNotes.length > 0);
      const hasImages = r.imageUrls && r.imageUrls.length > 0;
      return !hasDescription && !hasNotes && !hasImages;
    }).slice(0, 5);

    for (const req of incompleteRequests) {
      // Each enrichment is independent — failures don't affect others or the response
      jobberIntegration.fetchRequestDetail(req.id).then(async (detail) => {
        if (!detail) return;
        try {
          const noteMessages = (detail.notes?.edges ?? [])
            .map((e: any) => e.node?.message)
            .filter((m: unknown): m is string => typeof m === 'string' && (m as string).trim().length > 0);
          const description = noteMessages.join('\n\n');
          const imageUrls = (detail.noteAttachments?.edges ?? [])
            .filter((e: any) => e.node.contentType.startsWith('image/'))
            .map((e: any) => e.node.url);

          await query(
            `INSERT INTO jobber_webhook_requests
              (jobber_request_id, topic, account_id, title, client_name, description, request_body, image_urls, raw_payload, processed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (jobber_request_id, topic) DO UPDATE SET
               title = COALESCE(EXCLUDED.title, jobber_webhook_requests.title),
               client_name = COALESCE(EXCLUDED.client_name, jobber_webhook_requests.client_name),
               description = COALESCE(EXCLUDED.description, jobber_webhook_requests.description),
               request_body = COALESCE(EXCLUDED.request_body, jobber_webhook_requests.request_body),
               image_urls = COALESCE(EXCLUDED.image_urls, jobber_webhook_requests.image_urls),
               processed_at = NOW()`,
            [
              req.id,
              'API_FETCH',
              '',
              detail.title ?? null,
              detail.companyName || detail.contactName || null,
              description || null,
              JSON.stringify(detail),
              JSON.stringify(imageUrls),
              JSON.stringify({ source: 'api_fetch_enrichment' }),
            ],
          );
          console.log(`[jobber/requests] enriched request ${req.id}`);
        } catch (storeErr) {
          console.error(`[jobber/requests] failed to store enrichment for ${req.id}:`, storeErr instanceof Error ? storeErr.message : storeErr);
        }
      }).catch((fetchErr) => {
        console.error(`[jobber/requests] enrichment fetch failed for ${req.id}:`, fetchErr instanceof Error ? fetchErr.message : fetchErr);
      });
    }

    res.json({ requests, available });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobber/requests/:id
 * Fetch stored details for a single Jobber request (title, client, description, images, notes).
 */
router.get('/jobber/requests/:id', async (req, res, next) => {
  try {
    const requestId = req.params.id;

    let result = await query(
      `SELECT jobber_request_id, title, client_name, description, image_urls, request_body
       FROM jobber_webhook_requests
       WHERE jobber_request_id = $1
       ORDER BY processed_at DESC NULLS LAST, received_at DESC
       LIMIT 1`,
      [requestId],
    );

    // If not in DB, try fetching from the Jobber API and storing it
    if (result.rows.length === 0) {
      try {
        const detail = await jobberIntegration.fetchRequestDetail(requestId);
        if (detail) {
          const noteMessages = (detail.notes?.edges ?? [])
            .map((e: any) => e.node?.message)
            .filter((m: unknown): m is string => typeof m === 'string' && (m as string).trim().length > 0);
          const description = noteMessages.join('\n\n');
          const imageUrls = (detail.noteAttachments?.edges ?? [])
            .filter((e: any) => e.node.contentType.startsWith('image/'))
            .map((e: any) => e.node.url);

          await query(
            `INSERT INTO jobber_webhook_requests
              (jobber_request_id, topic, account_id, title, client_name, description, request_body, image_urls, raw_payload, processed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (jobber_request_id, topic) DO UPDATE SET
               title = COALESCE(EXCLUDED.title, jobber_webhook_requests.title),
               client_name = COALESCE(EXCLUDED.client_name, jobber_webhook_requests.client_name),
               description = COALESCE(EXCLUDED.description, jobber_webhook_requests.description),
               request_body = COALESCE(EXCLUDED.request_body, jobber_webhook_requests.request_body),
               image_urls = COALESCE(EXCLUDED.image_urls, jobber_webhook_requests.image_urls),
               processed_at = NOW()`,
            [
              requestId,
              'API_FETCH',
              '',
              detail.title ?? null,
              detail.companyName || detail.contactName || null,
              description || null,
              JSON.stringify(detail),
              JSON.stringify(imageUrls),
              JSON.stringify({ source: 'api_fetch' }),
            ],
          );

          // Re-query now that we've stored it
          result = await query(
            `SELECT jobber_request_id, title, client_name, description, image_urls, request_body
             FROM jobber_webhook_requests
             WHERE jobber_request_id = $1
             ORDER BY processed_at DESC NULLS LAST, received_at DESC
             LIMIT 1`,
            [requestId],
          );
        }
      } catch (fetchErr) {
        console.error('[quotes/request-detail] fetchRequestDetail fallback failed:', fetchErr instanceof Error ? fetchErr.message : fetchErr);
      }
    }

    if (result.rows.length === 0) {
      res.json({ request: null });
      return;
    }

    const row = result.rows[0] as Record<string, unknown>;

    // Extract notes from the stored request_body
    let notes: Array<{ message: string; createdBy: string; createdAt: string }> = [];
    if (row.request_body) {
      try {
        const detail = JSON.parse(row.request_body as string);
        const noteEdges = detail?.notes?.edges ?? [];
        notes = noteEdges
          .map((e: any) => e.node)
          .filter((n: any) => n?.message && typeof n.message === 'string' && n.message.trim().length > 0)
          .map((n: any) => {
            const typeName = n.createdBy?.__typename ?? '';
            let createdBy: 'team' | 'client' | 'system' = 'system';
            if (typeName === 'User') createdBy = 'team';
            else if (typeName === 'Client') createdBy = 'client';
            return {
              message: n.message,
              createdBy,
              createdAt: n.createdAt ?? '',
            };
          });
      } catch { /* ignore parse errors */ }
    }

    // Parse image_urls (stored as JSONB)
    let imageUrls: string[] = [];
    if (row.image_urls) {
      imageUrls = Array.isArray(row.image_urls) ? row.image_urls as string[] : [];
    }

    res.json({
      request: {
        id: row.jobber_request_id as string,
        title: (row.title as string) ?? '',
        clientName: (row.client_name as string) ?? '',
        description: (row.description as string) ?? '',
        imageUrls,
        notes,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /jobber/requests/:id/form-data
 * Fetch the form submission data for a specific Jobber request.
 * Tries the internal Jobber API first (requires web session cookies),
 * then falls back to building form data from stored webhook/API data.
 * If the request isn't in the DB yet, fetches it from the public API and stores it.
 */
router.get('/jobber/requests/:id/form-data', async (req, res, next) => {
  try {
    const requestId = req.params.id;

    // Try the internal Jobber API via Puppeteer browser session
    if (jobberWebSession.isConfigured()) {
      const formData = await jobberWebSession.fetchRequestFormData(requestId);
      if (formData) {
        res.json({ formData });
        return;
      }
    }

    // Check if we have this request stored in the webhook table
    let result = await query(
      `SELECT title, client_name, description, request_body, image_urls
       FROM jobber_webhook_requests
       WHERE jobber_request_id = $1
       ORDER BY processed_at DESC NULLS LAST, received_at DESC
       LIMIT 1`,
      [requestId],
    );

    // If not in DB, try fetching from the public Jobber API and storing it
    // (attempt even if isAvailable() is false — it may have recovered)
    if (result.rows.length === 0) {
      try {
        const detail = await jobberIntegration.fetchRequestDetail(requestId);
        if (detail) {
          const noteMessages = (detail.notes?.edges ?? [])
            .map((e: any) => e.node?.message)
            .filter((m: unknown): m is string => typeof m === 'string' && (m as string).trim().length > 0);
          const description = noteMessages.join('\n\n');
          const imageUrls = (detail.noteAttachments?.edges ?? [])
            .filter((e: any) => e.node.contentType.startsWith('image/'))
            .map((e: any) => e.node.url);

          await query(
            `INSERT INTO jobber_webhook_requests
              (jobber_request_id, topic, account_id, title, client_name, description, request_body, image_urls, raw_payload, processed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
              requestId,
              'API_FETCH',
              '',
              detail.title ?? null,
              detail.companyName || detail.contactName || null,
              description || null,
              JSON.stringify(detail),
              JSON.stringify(imageUrls),
              JSON.stringify({ source: 'api_fetch' }),
            ],
          );

          // Re-query now that we've stored it
          result = await query(
            `SELECT title, client_name, description, request_body, image_urls
             FROM jobber_webhook_requests
             WHERE jobber_request_id = $1
             ORDER BY processed_at DESC NULLS LAST, received_at DESC
             LIMIT 1`,
            [requestId],
          );
        }
      } catch (fetchErr) {
        console.error('[quotes/form-data] fetchRequestDetail fallback failed:', fetchErr instanceof Error ? fetchErr.message : fetchErr);
        // Best-effort — fall through to null
      }
    }

    if (result.rows.length === 0) {
      res.json({ formData: null });
      return;
    }

    const row = result.rows[0] as Record<string, unknown>;
    const sections: Array<{ label: string; sortOrder: number; answers: Array<{ label: string; value: string | null }> }> = [];
    const textParts: string[] = [];

    // Extract notes from the stored request body
    if (row.request_body) {
      try {
        const detail = JSON.parse(row.request_body as string);
        const noteEdges = detail?.notes?.edges ?? [];
        const noteMessages = noteEdges
          .map((e: any) => e.node?.message)
          .filter((m: unknown): m is string => typeof m === 'string' && m.trim().length > 0);

        if (noteMessages.length > 0) {
          sections.push({
            label: 'Notes',
            sortOrder: 2,
            answers: noteMessages.map((msg: string, i: number) => ({
              label: `Note ${i + 1}`,
              value: msg,
            })),
          });
          textParts.push(...noteMessages);
        }
      } catch { /* ignore parse errors */ }
    }

    // Add description if available and not already covered by notes
    const description = (row.description as string || '').trim();
    const descriptionAlreadyCovered = description.length > 0 && textParts.some(t =>
      t.includes(description) || description.includes(t)
    );
    if (description && !descriptionAlreadyCovered) {
      sections.unshift({
        label: 'Request Description',
        sortOrder: 1,
        answers: [{ label: 'Description', value: description }],
      });
      textParts.unshift(description);
    }

    if (sections.length === 0) {
      res.json({ formData: null });
      return;
    }

    res.json({
      formData: {
        sections,
        text: textParts.join('\n\n'),
      },
    });
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
    // Prefer DB-persisted token (survives refreshes across restarts)
    let accessToken = process.env.JOBBER_ACCESS_TOKEN;
    try {
      const tokenStore = new JobberTokenStore();
      const stored = await tokenStore.load();
      if (stored) accessToken = stored.accessToken;
    } catch { /* fall back to process.env */ }

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
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (jobber_request_id, topic) DO UPDATE SET
               title = COALESCE(EXCLUDED.title, jobber_webhook_requests.title),
               client_name = COALESCE(EXCLUDED.client_name, jobber_webhook_requests.client_name),
               description = COALESCE(EXCLUDED.description, jobber_webhook_requests.description),
               request_body = COALESCE(EXCLUDED.request_body, jobber_webhook_requests.request_body),
               image_urls = COALESCE(EXCLUDED.image_urls, jobber_webhook_requests.image_urls),
               raw_payload = EXCLUDED.raw_payload,
               processed_at = COALESCE(EXCLUDED.processed_at, jobber_webhook_requests.processed_at)`,
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

export { jobberIntegration };
export default router;
