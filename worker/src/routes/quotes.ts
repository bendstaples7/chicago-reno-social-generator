import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User, ProductCatalogEntry, QuoteTemplate, JobberCustomerRequest, RuleGroupWithRules } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import {
  QuoteEngine,
  JobberIntegration,
  QuoteDraftService,
  ActivityLogService,
  RulesService,
  RevisionEngine,
} from '../services/index.js';
import { JobberWebhookService } from '../services/jobber-webhook-service.js';
import { JobberTokenStore } from '../services/jobber-token-store.js';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();

// ── Helper: create a JobberIntegration with D1-persisted tokens ──

async function createJobberIntegration(db: D1Database, env: Bindings): Promise<{ jobberIntegration: JobberIntegration; tokenStore: JobberTokenStore; activityLog: ActivityLogService }> {
  const activityLog = new ActivityLogService(db);
  const tokenStore = new JobberTokenStore(db);
  const jobberIntegration = new JobberIntegration(activityLog, {
    clientId: env.JOBBER_CLIENT_ID || '',
    clientSecret: env.JOBBER_CLIENT_SECRET || '',
    accessToken: env.JOBBER_ACCESS_TOKEN || '',
    refreshToken: env.JOBBER_REFRESH_TOKEN || '',
    apiUrl: env.JOBBER_API_URL || undefined,
    tokenStore,
  });
  await jobberIntegration.loadPersistedTokens();
  return { jobberIntegration, tokenStore, activityLog };
}

app.use('*', sessionMiddleware);

// ── Rules CRUD endpoints ──────────────────────────────────────

/**
 * GET /rules
 * List all rule groups with their nested rules.
 */
app.get('/rules', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  const groups = await rulesService.getAllGroupedRules();
  return c.json(groups);
});

/**
 * POST /rules
 * Create a new rule.
 */
app.post('/rules', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  const { name, description, ruleGroupId, isActive } = await c.req.json() as {
    name?: string;
    description?: string;
    ruleGroupId?: string;
    isActive?: boolean;
  };
  const rule = await rulesService.createRule({
    name: name ?? '',
    description: description ?? '',
    ruleGroupId: ruleGroupId ?? undefined,
    isActive,
  });
  return c.json(rule, 201);
});

/**
 * PUT /rules/:id
 * Update an existing rule.
 */
app.put('/rules/:id', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  const { name, description, ruleGroupId, isActive } = await c.req.json() as {
    name?: string;
    description?: string;
    ruleGroupId?: string;
    isActive?: boolean;
  };
  const rule = await rulesService.updateRule(c.req.param('id'), {
    name,
    description,
    ruleGroupId,
    isActive,
  });
  return c.json(rule);
});

/**
 * PUT /rules/:id/deactivate
 * Deactivate a rule (soft delete).
 */
app.put('/rules/:id/deactivate', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  const rule = await rulesService.deactivateRule(c.req.param('id'));
  return c.json(rule);
});

/**
 * POST /rules/groups
 * Create a new rule group.
 */
app.post('/rules/groups', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  const { name, description } = await c.req.json() as { name?: string; description?: string };
  const group = await rulesService.createGroup({
    name: name ?? '',
    description,
  });
  return c.json(group, 201);
});

/**
 * PUT /rules/groups/:id
 * Update an existing rule group.
 */
app.put('/rules/groups/:id', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  const { name, description, displayOrder } = await c.req.json() as {
    name?: string;
    description?: string;
    displayOrder?: number;
  };
  const group = await rulesService.updateGroup(c.req.param('id'), {
    name,
    description,
    displayOrder,
  });
  return c.json(group);
});

/**
 * DELETE /rules/groups/:id
 * Delete a rule group (reassigns its rules to the "General" group).
 */
app.delete('/rules/groups/:id', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  await rulesService.deleteGroup(c.req.param('id'));
  return c.json({ success: true });
});

// ── Helper functions ──────────────────────────────────────────

async function fetchManualCatalog(db: D1Database, userId: string): Promise<ProductCatalogEntry[]> {
  const result = await db.prepare(
    'SELECT id, name, unit_price, description, category FROM manual_catalog_entries WHERE user_id = ? ORDER BY created_at ASC'
  ).bind(userId).all();

  return (result.results as any[]).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    unitPrice: Number(row.unit_price),
    description: (row.description as string) ?? '',
    category: (row.category as string) ?? undefined,
    source: 'manual' as const,
  }));
}

async function fetchManualTemplates(db: D1Database, userId: string): Promise<QuoteTemplate[]> {
  const result = await db.prepare(
    'SELECT id, name, content, category FROM manual_templates WHERE user_id = ? ORDER BY created_at ASC'
  ).bind(userId).all();

  return (result.results as any[]).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    content: row.content as string,
    category: (row.category as string) ?? undefined,
    source: 'manual' as const,
  }));
}

/**
 * POST /generate
 * Submit a customer request and generate a quote draft.
 */
app.post('/generate', async (c) => {
  const userId = c.get('user').id;
  const db = c.env.DB;
  const body = await c.req.json() as {
    customerText?: string;
    mediaItemIds?: string[];
    catalogSource?: 'jobber' | 'manual';
    manualCatalog?: ProductCatalogEntry[];
    manualTemplates?: QuoteTemplate[];
    jobberRequestId?: string;
  };

  if (!body.customerText && (!body.mediaItemIds || body.mediaItemIds.length === 0)) {
    throw new PlatformError({
      severity: 'error',
      component: 'QuoteRoutes',
      operation: 'generate',
      description: 'Please provide customer request text or at least one image.',
      recommendedActions: ['Enter customer text or upload images'],
    });
  }

  const { jobberIntegration } = await createJobberIntegration(db, c.env);
  const quoteEngine = new QuoteEngine(c.env.AI_TEXT_API_KEY, c.env.AI_TEXT_API_URL);
  const quoteDraftService = new QuoteDraftService(db);

  const source = body.catalogSource ?? (jobberIntegration.isAvailable() ? 'jobber' : 'manual');

  let catalog: ProductCatalogEntry[];
  let templates: QuoteTemplate[];

  if (source === 'jobber') {
    [catalog, templates] = await Promise.all([
      jobberIntegration.fetchProductCatalog(),
      jobberIntegration.fetchTemplateLibrary(),
    ]);
    if (!jobberIntegration.isAvailable()) {
      catalog = body.manualCatalog ?? await fetchManualCatalog(db, userId);
      templates = body.manualTemplates ?? await fetchManualTemplates(db, userId);
    }
  } else {
    catalog = body.manualCatalog ?? await fetchManualCatalog(db, userId);
    templates = body.manualTemplates ?? await fetchManualTemplates(db, userId);
  }

  // Fetch active rules for prompt injection (graceful degradation)
  const rulesService = new RulesService(db);
  let activeRules: RuleGroupWithRules[] = [];
  try {
    activeRules = await rulesService.getActiveRulesGrouped();
  } catch {
    // Proceed without rules if fetch fails
    activeRules = [];
  }

  const result = await quoteEngine.generateQuote(
    {
      customerText: body.customerText ?? '',
      mediaItemIds: body.mediaItemIds ?? [],
      userId,
      catalogSource: source,
      manualCatalog: source === 'manual' ? catalog : undefined,
      manualTemplates: source === 'manual' ? templates : undefined,
    },
    catalog,
    templates,
    activeRules,
  );

  if (body.jobberRequestId) {
    result.draft.jobberRequestId = body.jobberRequestId;
  }
  const saved = await quoteDraftService.save(result.draft);
  return c.json(saved, 201);
});

/**
 * GET /drafts
 * List saved quote drafts for the authenticated user.
 */
app.get('/drafts', async (c) => {
  const quoteDraftService = new QuoteDraftService(c.env.DB);
  const drafts = await quoteDraftService.list(c.get('user').id);
  return c.json({ drafts });
});

/**
 * GET /drafts/:id
 * Get a single quote draft by ID.
 */
app.get('/drafts/:id', async (c) => {
  const quoteDraftService = new QuoteDraftService(c.env.DB);
  const draft = await quoteDraftService.getById(c.req.param('id'), c.get('user').id);
  return c.json(draft);
});

/**
 * PUT /drafts/:id
 * Update a quote draft.
 */
app.put('/drafts/:id', async (c) => {
  const body = await c.req.json() as {
    lineItems?: any[];
    unresolvedItems?: any[];
    selectedTemplateId?: string | null;
    status?: 'draft' | 'finalized';
  };
  const quoteDraftService = new QuoteDraftService(c.env.DB);
  const draft = await quoteDraftService.update(c.req.param('id'), c.get('user').id, {
    lineItems: body.lineItems,
    unresolvedItems: body.unresolvedItems,
    selectedTemplateId: body.selectedTemplateId,
    status: body.status,
  });
  return c.json(draft);
});

/**
 * DELETE /drafts/:id
 * Delete a quote draft.
 */
app.delete('/drafts/:id', async (c) => {
  const quoteDraftService = new QuoteDraftService(c.env.DB);
  await quoteDraftService.delete(c.req.param('id'), c.get('user').id);
  return c.json({ success: true });
});

/**
 * POST /drafts/:id/revise
 * Submit feedback and get a revised draft.
 */
app.post('/drafts/:id/revise', async (c) => {
  const userId = c.get('user').id;
  const db = c.env.DB;
  const draftId = c.req.param('id');
  const { feedbackText, createRule: shouldCreateRule } = await c.req.json() as {
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

  const quoteDraftService = new QuoteDraftService(db);
  const revisionEngine = new RevisionEngine(c.env.AI_TEXT_API_KEY, c.env.AI_TEXT_API_URL);
  const rulesService = new RulesService(db);

  // Load the current draft (verifies ownership)
  const draft = await quoteDraftService.getById(draftId, userId);

  // Fetch the product catalog
  const { jobberIntegration } = await createJobberIntegration(db, c.env);
  let catalog: ProductCatalogEntry[];
  if (draft.catalogSource === 'jobber' && jobberIntegration.isAvailable()) {
    catalog = await jobberIntegration.fetchProductCatalog();
    if (!jobberIntegration.isAvailable()) {
      catalog = await fetchManualCatalog(db, userId);
    }
  } else {
    catalog = await fetchManualCatalog(db, userId);
  }

  // Fetch active rules for prompt injection
  let activeRules: RuleGroupWithRules[] = [];
  try {
    activeRules = await rulesService.getActiveRulesGrouped();
  } catch {
    activeRules = [];
  }

  // Revise the draft
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

  return c.json({
    ...updated,
    ...(ruleCreated ? { ruleCreated } : {}),
    ...(ruleCreationError ? { ruleCreationError } : {}),
  });
});

/**
 * GET /catalog
 * Get the current product catalog (from Jobber or manual entries).
 */
app.get('/catalog', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const { jobberIntegration } = await createJobberIntegration(db, c.env);

  let catalog: ProductCatalogEntry[];
  if (jobberIntegration.isAvailable()) {
    catalog = await jobberIntegration.fetchProductCatalog();
  }
  if (!jobberIntegration.isAvailable()) {
    catalog = await fetchManualCatalog(db, userId);
  }
  return c.json({ catalog: catalog! });
});

/**
 * POST /catalog
 * Save manual catalog entries (for fallback mode).
 */
app.post('/catalog', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json() as {
    entries: Array<{ name: string; unitPrice: number; description?: string; category?: string }>;
  };

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    throw new PlatformError({
      severity: 'error',
      component: 'QuoteRoutes',
      operation: 'saveCatalog',
      description: 'Please provide at least one catalog entry.',
      recommendedActions: ['Add product entries with name and unit price'],
    });
  }

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM manual_catalog_entries WHERE user_id = ?').bind(userId),
  ];

  for (const entry of body.entries) {
    statements.push(
      db.prepare(
        "INSERT INTO manual_catalog_entries (id, user_id, name, unit_price, description, category) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
        crypto.randomUUID(),
        userId,
        entry.name,
        entry.unitPrice,
        entry.description ?? null,
        entry.category ?? null,
      ),
    );
  }

  await db.batch(statements);

  const catalog = await fetchManualCatalog(db, userId);
  return c.json({ catalog });
});

/**
 * GET /templates
 * Get the current template library (from Jobber or manual entries).
 */
app.get('/templates', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const { jobberIntegration } = await createJobberIntegration(db, c.env);

  let templates: QuoteTemplate[];
  if (jobberIntegration.isAvailable()) {
    templates = await jobberIntegration.fetchTemplateLibrary();
  }
  if (!jobberIntegration.isAvailable()) {
    templates = await fetchManualTemplates(db, userId);
  }
  return c.json({ templates: templates! });
});

/**
 * POST /templates
 * Save manual template entries (for fallback mode).
 */
app.post('/templates', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json() as {
    entries: Array<{ name: string; content: string; category?: string }>;
  };

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    throw new PlatformError({
      severity: 'error',
      component: 'QuoteRoutes',
      operation: 'saveTemplates',
      description: 'Please provide at least one template entry.',
      recommendedActions: ['Add template entries with name and content'],
    });
  }

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM manual_templates WHERE user_id = ?').bind(userId),
  ];

  for (const entry of body.entries) {
    statements.push(
      db.prepare(
        "INSERT INTO manual_templates (id, user_id, name, content, category) VALUES (?, ?, ?, ?, ?)"
      ).bind(
        crypto.randomUUID(),
        userId,
        entry.name,
        entry.content,
        entry.category ?? null,
      ),
    );
  }

  await db.batch(statements);

  const templates = await fetchManualTemplates(db, userId);
  return c.json({ templates });
});

/**
 * POST /corpus/sync
 * Corpus sync is not yet ported to the worker.
 * Returns a stub response so the client doesn't get a 404.
 */
app.post('/corpus/sync', async (c) => {
  return c.json({
    totalFetched: 0,
    newQuotes: 0,
    updatedQuotes: 0,
    unchangedQuotes: 0,
    embeddingsGenerated: 0,
    durationMs: 0,
    error: 'Corpus sync is not yet available in the deployed environment. Use the development server to sync.',
  });
});

/**
 * GET /corpus/status
 * Get the current corpus status (quote count and last sync timestamp).
 */
app.get('/corpus/status', async (c) => {
  const db = c.env.DB;
  try {
    const row = await db.prepare(
      'SELECT total_quotes, last_sync_at FROM quote_corpus_sync_status WHERE id = 1'
    ).first() as { total_quotes: number; last_sync_at: string | null } | null;

    if (!row) {
      return c.json({ totalQuotes: 0, lastSyncAt: null });
    }

    return c.json({
      totalQuotes: Number(row.total_quotes),
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
    });
  } catch {
    // Table may not exist yet — return safe defaults
    return c.json({ totalQuotes: 0, lastSyncAt: null });
  }
});

/**
 * GET /jobber/requests/:id
 * Fetch stored details for a single Jobber request.
 */
app.get('/jobber/requests/:id', async (c) => {
  const db = c.env.DB;
  const requestId = c.req.param('id');

  const row = await db.prepare(
    `SELECT jobber_request_id, title, client_name, description, image_urls, request_body
     FROM jobber_webhook_requests
     WHERE jobber_request_id = ?
     ORDER BY processed_at DESC, received_at DESC
     LIMIT 1`
  ).bind(requestId).first() as Record<string, unknown> | null;

  if (!row) {
    return c.json({ request: null });
  }

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

  // Parse image_urls (stored as JSON text)
  let imageUrls: string[] = [];
  if (row.image_urls) {
    try {
      const parsed = typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls;
      imageUrls = Array.isArray(parsed) ? parsed : [];
    } catch {
      imageUrls = [];
    }
  }

  return c.json({
    request: {
      id: row.jobber_request_id as string,
      title: (row.title as string) ?? '',
      clientName: (row.client_name as string) ?? '',
      description: (row.description as string) ?? '',
      imageUrls,
      notes,
    },
  });
});

/**
 * GET /jobber/requests/:id/form-data
 * Fetch the form submission data for a specific Jobber request.
 * Builds form data from stored webhook/API data since the Jobber web
 * session (Auth0 cookie-based) is not available in the Worker environment.
 */
app.get('/jobber/requests/:id/form-data', async (c) => {
  const db = c.env.DB;
  const requestId = c.req.param('id');

  // Build form data from webhook/API data stored in D1
  const row = await db.prepare(
    `SELECT title, client_name, description, request_body, image_urls
     FROM jobber_webhook_requests
     WHERE jobber_request_id = ?
     ORDER BY processed_at DESC, received_at DESC
     LIMIT 1`
  ).bind(requestId).first() as Record<string, unknown> | null;

  if (!row) {
    return c.json({ formData: null });
  }

  const sections: Array<{ label: string; sortOrder: number; answers: Array<{ label: string; value: string | null }> }> = [];
  const textParts: string[] = [];

  // Extract notes from the stored request body
  if (row.request_body) {
    try {
      const detail = JSON.parse(row.request_body as string);
      const noteEdges = detail?.notes?.edges ?? [];
      const noteMessages = noteEdges
        .map((e: any) => e.node?.message)
        .filter((m: unknown): m is string => typeof m === 'string' && (m as string).trim().length > 0);

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
  const description = ((row.description as string) || '').trim();
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
    return c.json({ formData: null });
  }

  return c.json({
    formData: {
      sections,
      text: textParts.join('\n\n'),
    },
  });
});

/**
 * GET /jobber/requests
 * Fetch customer requests from Jobber, enriched with webhook data.
 */
app.get('/jobber/requests', async (c) => {
  const db = c.env.DB;
  const { jobberIntegration, tokenStore, activityLog } = await createJobberIntegration(db, c.env);

  let requests: JobberCustomerRequest[] = [];
  let available = false;

  if (jobberIntegration.isAvailable()) {
    requests = await jobberIntegration.fetchCustomerRequests();
    available = jobberIntegration.isAvailable();
  }

  // Merge webhook data
  try {
    const webhookService = new JobberWebhookService(db, activityLog, {
      accessToken: c.env.JOBBER_ACCESS_TOKEN || '',
      clientSecret: c.env.JOBBER_CLIENT_SECRET || '',
      clientId: c.env.JOBBER_CLIENT_ID || '',
      refreshToken: c.env.JOBBER_REFRESH_TOKEN || '',
      tokenStore,
    });
    await webhookService.loadPersistedTokens();
    const webhookRequests = await webhookService.getWebhookRequests();
    const apiIds = new Set(requests.map((r) => r.id));

    for (const wr of webhookRequests) {
      if (apiIds.has(wr.id)) {
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
        requests.push(wr);
      }
    }

    requests.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (webhookRequests.length > 0) available = true;
  } catch {
    // Webhook enrichment is best-effort
  }

  return c.json({ requests, available });
});

/**
 * GET /jobber/status
 * Check Jobber API availability.
 */
app.get('/jobber/status', async (c) => {
  const db = c.env.DB;
  const { jobberIntegration } = await createJobberIntegration(db, c.env);

  let webhookActive = false;
  try {
    const result = await db.prepare(
      `SELECT COUNT(*) as count FROM jobber_webhook_requests WHERE processed_at IS NOT NULL`
    ).first() as { count: number } | null;
    webhookActive = (result?.count ?? 0) > 0;
  } catch { /* table may not exist yet */ }

  return c.json({ available: jobberIntegration.isAvailable() || webhookActive, webhookActive });
});

export default app;
