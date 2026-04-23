import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User, ProductCatalogEntry, QuoteTemplate, JobberCustomerRequest, RuleGroupWithRules, SimilarQuote, StructuredRule, RuleCondition, RuleAction, TriggerMode } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import { JobberWebSession } from '../services/jobber-web-session.js';
import {
  QuoteEngine,
  JobberIntegration,
  QuoteDraftService,
  ActivityLogService,
  RulesService,
  RevisionEngine,
  EmbeddingService,
  SimilarityEngine,
  QuoteSyncService,
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
  const { name, description, ruleGroupId, isActive, conditionJson, actionJson, triggerMode } = await c.req.json() as {
    name?: string;
    description?: string;
    ruleGroupId?: string;
    isActive?: boolean;
    conditionJson?: RuleCondition;
    actionJson?: RuleAction[];
    triggerMode?: TriggerMode;
  };
  const rule = await rulesService.createRule({
    name: name ?? '',
    description: description ?? '',
    ruleGroupId: ruleGroupId ?? undefined,
    isActive,
    conditionJson,
    actionJson,
    triggerMode,
  });
  return c.json(rule, 201);
});

/**
 * PUT /rules/:id
 * Update an existing rule.
 */
app.put('/rules/:id', async (c) => {
  const rulesService = new RulesService(c.env.DB);
  const { name, description, ruleGroupId, isActive, conditionJson, actionJson, triggerMode } = await c.req.json() as {
    name?: string;
    description?: string;
    ruleGroupId?: string;
    isActive?: boolean;
    conditionJson?: RuleCondition | null;
    actionJson?: RuleAction[] | null;
    triggerMode?: TriggerMode;
  };
  const rule = await rulesService.updateRule(c.req.param('id'), {
    name,
    description,
    ruleGroupId,
    isActive,
    conditionJson,
    actionJson,
    triggerMode,
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
    'SELECT id, name, content, category, line_items_json FROM manual_templates WHERE user_id = ? ORDER BY created_at ASC'
  ).bind(userId).all();

  return (result.results as any[]).map((row) => {
    let lineItems: QuoteTemplate['lineItems'] = [];
    try {
      const parsed = JSON.parse((row.line_items_json as string) || '[]');
      if (Array.isArray(parsed)) lineItems = parsed;
    } catch { /* ignore parse errors */ }

    return {
      id: row.id as string,
      name: row.name as string,
      content: row.content as string,
      category: (row.category as string) ?? undefined,
      lineItems,
      source: 'manual' as const,
    };
  });
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
  // Templates always come from D1 — Jobber's public API does not expose quote templates
  const templates: QuoteTemplate[] = body.manualTemplates ?? await fetchManualTemplates(db, userId);

  if (source === 'jobber') {
    catalog = await jobberIntegration.fetchProductCatalog();
    if (!jobberIntegration.isAvailable()) {
      catalog = body.manualCatalog ?? await fetchManualCatalog(db, userId);
    }
  } else {
    catalog = body.manualCatalog ?? await fetchManualCatalog(db, userId);
  }

  // Fetch active rules for prompt injection (graceful degradation)
  const rulesService = new RulesService(db);
  let activeRules: RuleGroupWithRules[] = [];
  try {
    activeRules = await rulesService.getActiveRulesGrouped();
  } catch {
    activeRules = [];
  }

  // Fetch structured rules for the deterministic rules engine (graceful degradation)
  let structuredRules: StructuredRule[] = [];
  try {
    structuredRules = await rulesService.getActiveStructuredRules();
  } catch {
    structuredRules = [];
  }

  // Find similar past quotes from the corpus (graceful degradation)
  let similarQuotes: SimilarQuote[] = [];
  const trimmedCustomerText = (body.customerText ?? '').trim();
  if (trimmedCustomerText) {
    try {
      const embeddingService = new EmbeddingService(c.env.AI_TEXT_API_KEY);
      const similarityEngine = new SimilarityEngine(db, embeddingService);
      const results = await similarityEngine.findSimilar(trimmedCustomerText);
      similarQuotes = results.map((sq) => ({
      jobberQuoteId: sq.jobberQuoteId,
      quoteNumber: sq.quoteNumber,
      title: sq.title,
      message: sq.message,
      similarityScore: sq.similarityScore,
    }));
    } catch {
      similarQuotes = [];
    }
  }

  const result = await quoteEngine.generateQuote(
    {
      customerText: body.customerText ?? '',
      mediaItemIds: body.mediaItemIds ?? [],
      userId,
      catalogSource: source,
      manualCatalog: source === 'manual' ? catalog : undefined,
      manualTemplates: source === 'manual' ? templates : undefined,
      similarQuotes,
    },
    catalog,
    templates,
    activeRules,
    structuredRules,
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

  // Create the rule BEFORE revision so the AI sees it during this revision
  let ruleCreated: { id: string; name: string } | undefined;
  let ruleCreationError: string | undefined;
  if (shouldCreateRule) {
    try {
      const newRule = await rulesService.createRuleFromFeedback(trimmed);
      ruleCreated = { id: newRule.id, name: newRule.name };
      // Re-fetch rules so the newly created rule is included in the prompt
      try {
        activeRules = await rulesService.getActiveRulesGrouped();
      } catch { /* keep the previously fetched rules */ }
    } catch (ruleErr) {
      ruleCreationError = ruleErr instanceof PlatformError
        ? ruleErr.description
        : ruleErr instanceof Error
          ? ruleErr.message
          : 'Unknown error creating rule';
    }
  }

  // Fetch structured rules for the deterministic rules engine (graceful degradation)
  let structuredRules: StructuredRule[] = [];
  try {
    structuredRules = await rulesService.getActiveStructuredRules();
  } catch {
    structuredRules = [];
  }

  // Revise the draft
  const revised = await revisionEngine.revise({
    feedbackText: trimmed,
    customerRequestText: draft.customerRequestText,
    currentLineItems: draft.lineItems,
    currentUnresolvedItems: draft.unresolvedItems,
    catalog,
    rules: activeRules,
    structuredRules,
  });

  // If the AI response couldn't be parsed, inform the user
  if (revised.revisionFailed) {
    throw new PlatformError({
      severity: 'warning',
      component: 'QuoteRoutes',
      operation: 'revise',
      description: 'The AI could not process your feedback. Your draft was not changed. Please try rephrasing your feedback.',
      recommendedActions: ['Rephrase your feedback and try again'],
    });
  }

  // Update the draft with revised line items
  const updated = await quoteDraftService.update(draftId, userId, {
    lineItems: revised.lineItems,
    unresolvedItems: revised.unresolvedItems,
  });

  // Persist the revision history entry (after successful update)
  await quoteDraftService.addRevisionEntry(draftId, userId, trimmed);

  return c.json({
    ...updated,
    ...(ruleCreated ? { ruleCreated } : {}),
    ...(ruleCreationError ? { ruleCreationError } : {}),
    ...(revised.rulesEngineAuditTrail ? { rulesEngineAuditTrail: revised.rulesEngineAuditTrail } : {}),
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
 * PATCH /catalog/:id
 * Update a single catalog entry's name and/or description.
 */
app.patch('/catalog/:id', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const entryId = c.req.param('id');
  const body = await c.req.json() as { name?: string; description?: string };

  // Validate inputs
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'updateCatalogEntry',
        description: 'Name cannot be empty.',
        recommendedActions: ['Provide a non-empty name'],
      });
    }
    body.name = body.name.trim();
    if (body.name.length > 200) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'updateCatalogEntry',
        description: 'Name must be 200 characters or fewer.',
        recommendedActions: ['Shorten the name'],
      });
    }
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'updateCatalogEntry',
        description: 'Description must be a string.',
        recommendedActions: ['Provide a valid description'],
      });
    }
    body.description = body.description.trim();
    if (body.description.length > 1000) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'updateCatalogEntry',
        description: 'Description must be 1000 characters or fewer.',
        recommendedActions: ['Shorten the description'],
      });
    }
  }

  // Verify ownership — only manual catalog entries can be updated
  const existing = await db.prepare(
    'SELECT id FROM manual_catalog_entries WHERE id = ? AND user_id = ?'
  ).bind(entryId, userId).first();

  if (!existing) {
    throw new PlatformError({
      severity: 'error',
      component: 'QuoteRoutes',
      operation: 'updateCatalogEntry',
      description: 'Catalog entry not found.',
      recommendedActions: ['Verify the entry exists'],
    });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    setClauses.push('name = ?');
    values.push(body.name);
  }
  if (body.description !== undefined) {
    setClauses.push('description = ?');
    values.push(body.description);
  }

  if (setClauses.length > 0) {
    values.push(entryId, userId);
    await db.prepare(
      'UPDATE manual_catalog_entries SET ' + setClauses.join(', ') + ' WHERE id = ? AND user_id = ?'
    ).bind(...values).run();
  }

  return c.json({ success: true });
});

/**
 * GET /templates
 * Get the current template library (always from D1 manual_templates).
 * Jobber's public API does not expose quote templates.
 */
app.get('/templates', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const templates = await fetchManualTemplates(db, userId);
  return c.json({ templates });
});

/**
 * POST /templates
 * Save manual template entries (for fallback mode).
 */
app.post('/templates', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json() as {
    entries: Array<{ name: string; content: string; category?: string; lineItems?: Array<{ name: string; description: string; quantity: number; unitPrice: number }> }>;
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

  // Check for duplicate names within the batch
  const nameSet = new Set<string>();
  for (const entry of body.entries) {
    if (!entry.name || typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'saveTemplates',
        description: 'Each template entry must have a non-empty name.',
        recommendedActions: ['Provide a name for every template entry'],
      });
    }
    const normalized = entry.name.trim().toLowerCase();
    if (nameSet.has(normalized)) {
      throw new PlatformError({
        severity: 'error',
        component: 'QuoteRoutes',
        operation: 'saveTemplates',
        description: `Duplicate template name: "${entry.name.trim()}".`,
        recommendedActions: ['Remove or rename duplicate template entries'],
      });
    }
    nameSet.add(normalized);
  }

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM manual_templates WHERE user_id = ?').bind(userId),
  ];

  for (const entry of body.entries) {
    statements.push(
      db.prepare(
        "INSERT INTO manual_templates (id, user_id, name, content, category, line_items_json) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
        crypto.randomUUID(),
        userId,
        entry.name,
        entry.content,
        entry.category ?? null,
        JSON.stringify(entry.lineItems ?? []),
      ),
    );
  }

  await db.batch(statements);

  const templates = await fetchManualTemplates(db, userId);
  return c.json({ templates });
});

/**
 * POST /templates/from-draft
 * Save a quote draft as a reusable template.
 */
app.post('/templates/from-draft', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const body = await c.req.json() as {
    draftId: string;
    name: string;
    category?: string;
  };

  if (!body.draftId || !body.name?.trim()) {
    throw new PlatformError({
      severity: 'error',
      component: 'QuoteRoutes',
      operation: 'saveTemplateFromDraft',
      description: 'Please provide a draft ID and template name.',
      recommendedActions: ['Provide both draftId and name fields'],
    });
  }

  // Check for duplicate template name
  const existing = await db.prepare(
    'SELECT id FROM manual_templates WHERE user_id = ? AND name = ? COLLATE NOCASE'
  ).bind(userId, body.name.trim()).first();
  if (existing) {
    throw new PlatformError({
      severity: 'warning',
      component: 'QuoteRoutes',
      operation: 'saveTemplateFromDraft',
      description: `A template named "${body.name.trim()}" already exists.`,
      recommendedActions: ['Choose a different name or delete the existing template first'],
    });
  }

  const quoteDraftService = new QuoteDraftService(db);
  const draft = await quoteDraftService.getById(body.draftId, userId);

  // Convert draft line items to template line items
  const lineItems = [...draft.lineItems, ...draft.unresolvedItems].map((li) => ({
    name: li.productName,
    description: li.originalText || '',
    quantity: li.quantity,
    unitPrice: li.unitPrice,
  }));

  const templateId = crypto.randomUUID();
  try {
    await db.prepare(
      "INSERT INTO manual_templates (id, user_id, name, content, category, line_items_json) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(
      templateId,
      userId,
      body.name.trim(),
      draft.customerRequestText || '',
      body.category ?? null,
      JSON.stringify(lineItems),
    ).run();
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      throw new PlatformError({
        severity: 'warning',
        component: 'QuoteRoutes',
        operation: 'saveTemplateFromDraft',
        description: `A template named "${body.name.trim()}" already exists.`,
        recommendedActions: ['Choose a different name or delete the existing template first'],
      });
    }
    throw dbErr;
  }

  const templates = await fetchManualTemplates(db, userId);
  return c.json({ template: templates.find((t) => t.id === templateId), templates });
});

/**
 * DELETE /templates/:id
 * Delete a single template by ID.
 */
app.delete('/templates/:id', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const templateId = c.req.param('id');

  await db.prepare(
    'DELETE FROM manual_templates WHERE id = ? AND user_id = ?'
  ).bind(templateId, userId).run();

  const templates = await fetchManualTemplates(db, userId);
  return c.json({ templates });
});

/**
 * POST /corpus/sync
 * Trigger a manual corpus synchronization with Jobber.
 */
app.post('/corpus/sync', async (c) => {
  const db = c.env.DB;

  // Atomic concurrency guard: claim the lock only if not already running (or stale > 10 min)
  const claimResult = await db.prepare(
    `UPDATE quote_corpus_sync_status
     SET last_sync_at = datetime('now'), last_sync_error = '__RUNNING__'
     WHERE id = 1 AND (last_sync_error != '__RUNNING__' OR last_sync_error IS NULL
       OR last_sync_at < datetime('now', '-10 minutes'))`
  ).run();

  if (!claimResult.meta.changes || claimResult.meta.changes === 0) {
    return c.json({ error: 'A corpus sync is already in progress. Please wait and try again.' }, 409);
  }

  const { jobberIntegration, activityLog } = await createJobberIntegration(db, c.env);
  const embeddingService = new EmbeddingService(c.env.AI_TEXT_API_KEY);
  const quoteSyncService = new QuoteSyncService(db, embeddingService, activityLog, jobberIntegration);

  try {
    const result = await quoteSyncService.sync();
    return c.json(result);
  } finally {
    // Clear the running marker — sync() already calls updateSyncStatus on success/failure,
    // but if something unexpected throws before that, ensure the lock is released.
    try {
      const stillRunning = await db.prepare(
        "SELECT 1 FROM quote_corpus_sync_status WHERE id = 1 AND last_sync_error = '__RUNNING__'"
      ).first();
      if (stillRunning) {
        await db.prepare(
          "UPDATE quote_corpus_sync_status SET last_sync_error = 'Sync terminated unexpectedly' WHERE id = 1 AND last_sync_error = '__RUNNING__'"
        ).run();
      }
    } catch { /* best-effort cleanup */ }
  }
});

/**
 * GET /corpus/status
 * Get the current corpus status (quote count and last sync timestamp).
 */
app.get('/corpus/status', async (c) => {
  const db = c.env.DB;
  const { jobberIntegration, activityLog } = await createJobberIntegration(db, c.env);
  const embeddingService = new EmbeddingService(c.env.AI_TEXT_API_KEY);
  const quoteSyncService = new QuoteSyncService(db, embeddingService, activityLog, jobberIntegration);
  const status = await quoteSyncService.getStatus();
  return c.json(status);
});

/**
 * GET /jobber/requests/:id
 * Fetch stored details for a single Jobber request.
 * Re-fetches attachment URLs from Jobber API since stored URLs are signed and expire.
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

  // Re-fetch fresh attachment URLs from Jobber API (stored URLs are signed S3 URLs that expire).
  // Falls back to stored URLs only if the refresh fails or times out — not when the request
  // genuinely has no images (successful empty response means no images exist).
  let imageUrls: string[] = [];
  let refreshSucceeded = false;
  try {
    const { jobberIntegration } = await createJobberIntegration(db, c.env);
    if (jobberIntegration.isAvailable()) {
      // Race the API call against a 5-second timeout to avoid blocking the response.
      // If the timeout wins, push the orphaned promise into waitUntil so the Worker
      // lets it finish in the background rather than abandoning it mid-flight.
      const apiPromise = jobberIntegration.graphqlRequest<Record<string, unknown>>(
        `query FetchAttachments($id: EncodedId!) {
          request(id: $id) {
            noteAttachments(first: 20) { edges { node { url fileName contentType } } }
          }
        }`,
        { id: requestId },
      );
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));

      const freshResult = await Promise.race([apiPromise, timeoutPromise]);
      if (freshResult === null) {
        // Timeout won — let the API call finish in the background
        c.executionCtx.waitUntil(apiPromise.catch(() => {}));
      } else {
        refreshSucceeded = true;
        const freshUrls = ((freshResult as any)?.request?.noteAttachments?.edges ?? [])
          .filter((e: any) => e.node?.contentType?.startsWith('image/'))
          .map((e: any) => e.node.url);
        imageUrls = freshUrls;
        // Update stored URLs so other consumers get fresh ones too
        await db.prepare(
          'UPDATE jobber_webhook_requests SET image_urls = ? WHERE jobber_request_id = ?'
        ).bind(JSON.stringify(imageUrls), requestId).run();
      }
    }
  } catch {
    // Graceful fallback — use stored URLs
  }

  // Fallback to stored URLs only when the refresh failed or timed out.
  // If the refresh succeeded with 0 images, that's the truth — don't serve stale URLs.
  if (!refreshSucceeded && row.image_urls) {
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
 * Primary: Jobber internal API via web session cookies (requestDetails.form).
 * Fallback: D1 stored data → Jobber public API fetch + store → null.
 */
app.get('/jobber/requests/:id/form-data', async (c) => {
  const db = c.env.DB;
  const requestId = c.req.param('id');

  // Step 1: Try the internal Jobber API using web session cookies
  // This is the only way to get requestDetails.form (customer form submissions)
  try {
    const webSession = new JobberWebSession(db);
    const result = await webSession.fetchRequestFormData(requestId);
    if (result.formData) {
      return c.json({ formData: result.formData });
    }
    // If sessionExpired or no data, fall through to fallback
  } catch (err) {
    console.warn('[quotes/form-data] Web session fetch failed:', err instanceof Error ? err.message : err);
  }

  // Step 2: Fallback — check D1 for stored webhook/API data
  let row = await db.prepare(
    `SELECT title, client_name, description, request_body, image_urls
     FROM jobber_webhook_requests
     WHERE jobber_request_id = ?
     ORDER BY processed_at DESC, received_at DESC
     LIMIT 1`
  ).bind(requestId).first() as Record<string, unknown> | null;

  // Step 3: If not in D1, fetch from Jobber public GraphQL API and store
  if (!row || row.request_body == null) {
    try {
      const { jobberIntegration } = await createJobberIntegration(db, c.env);
      const detail = await jobberIntegration.graphqlRequest<Record<string, unknown>>(
        `query FetchRequestDetail($id: EncodedId!) {
          request(id: $id) {
            id title companyName contactName phone email requestStatus createdAt jobberWebUri
            client { id firstName lastName companyName }
            notes(first: 20) { edges { node { ... on RequestNote { message createdAt createdBy { __typename } } } } }
            noteAttachments(first: 20) { edges { node { url fileName contentType } } }
          }
        }`,
        { id: requestId },
      );
      const request = (detail as any)?.request;
      if (request) {
        const noteMessages = (request.notes?.edges ?? [])
          .map((e: any) => e.node?.message)
          .filter((m: unknown): m is string => typeof m === 'string' && (m as string).trim().length > 0);
        const description = noteMessages.join('\n\n');
        const imageUrls = (request.noteAttachments?.edges ?? [])
          .filter((e: any) => e.node?.contentType?.startsWith('image/'))
          .map((e: any) => e.node.url);
        const clientName = request.companyName || request.contactName
          || (request.client ? `${request.client.firstName || ''} ${request.client.lastName || ''}`.trim() || request.client.companyName : null)
          || null;

        await db.prepare(
          `INSERT INTO jobber_webhook_requests
            (id, jobber_request_id, topic, account_id, title, client_name, description, request_body, image_urls, raw_payload, processed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (jobber_request_id, topic) DO UPDATE SET
             title = excluded.title, client_name = excluded.client_name, description = excluded.description,
             request_body = excluded.request_body, image_urls = excluded.image_urls, processed_at = excluded.processed_at`
        ).bind(
          crypto.randomUUID(), requestId, 'API_FETCH', '',
          request.title ?? null, clientName, description || null,
          JSON.stringify(request), JSON.stringify(imageUrls),
          JSON.stringify({ source: 'api_fetch' }), new Date().toISOString(),
        ).run();

        row = await db.prepare(
          `SELECT title, client_name, description, request_body, image_urls
           FROM jobber_webhook_requests WHERE jobber_request_id = ?
           ORDER BY processed_at DESC, received_at DESC LIMIT 1`
        ).bind(requestId).first() as Record<string, unknown> | null;
      }
    } catch (fetchErr) {
      console.error('[quotes/form-data] API fallback failed:', fetchErr instanceof Error ? fetchErr.message : fetchErr);
    }
  }

  // Step 4: Build form data from D1 row (notes + description)
  if (!row) {
    return c.json({ formData: null });
  }

  const sections: Array<{ label: string; sortOrder: number; answers: Array<{ label: string; value: string | null }> }> = [];
  const textParts: string[] = [];

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
          answers: noteMessages.map((msg: string, i: number) => ({ label: `Note ${i + 1}`, value: msg })),
        });
        textParts.push(...noteMessages);
      }
    } catch { /* ignore parse errors */ }
  }

  const description = ((row.description as string) || '').trim();
  const descriptionAlreadyCovered = description.length > 0 && textParts.some(t =>
    t.includes(description) || description.includes(t)
  );
  if (description && !descriptionAlreadyCovered) {
    sections.unshift({ label: 'Request Description', sortOrder: 1, answers: [{ label: 'Description', value: description }] });
    textParts.unshift(description);
  }

  if (sections.length === 0) {
    return c.json({ formData: null });
  }

  return c.json({ formData: { sections, text: textParts.join('\n\n') } });
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
    console.log(`[quotes/requests] GraphQL returned ${requests.length} requests, available=${available}`);
  } else {
    console.log('[quotes/requests] Jobber API not available, skipping GraphQL call');
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
    try {
      await webhookService.loadPersistedTokens();
    } catch (tokenErr) {
      console.warn('[quotes/requests] Failed to load persisted tokens for webhook service:', tokenErr instanceof Error ? tokenErr.message : tokenErr);
    }
    const webhookRequests = await webhookService.getWebhookRequests();
    console.log(`[quotes/requests] Webhook merge: ${webhookRequests.length} webhook requests, ${requests.length} API requests`);
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
  } catch (webhookErr) {
    console.error('[quotes/requests] Webhook enrichment failed:', webhookErr instanceof Error ? webhookErr.message : webhookErr);
    // Webhook enrichment is best-effort
  }

  // Background enrichment: identify incomplete requests and fetch full details from Jobber API
  const incomplete = requests.filter(
    (r) => !r.description && r.structuredNotes.length === 0 && r.imageUrls.length === 0
  );
  const toEnrich = incomplete.slice(0, 5);

  if (toEnrich.length > 0 && jobberIntegration.isAvailable() && c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(
      Promise.allSettled(
        toEnrich.map(async (req) => {
          try {
            const detail = await jobberIntegration.graphqlRequest<Record<string, unknown>>(
              `query FetchRequestDetail($id: EncodedId!) {
                request(id: $id) {
                  id title companyName contactName phone email requestStatus createdAt jobberWebUri
                  client { id firstName lastName companyName }
                  notes(first: 20) { edges { node { ... on RequestNote { message createdAt createdBy { __typename } } } } }
                  noteAttachments(first: 20) { edges { node { url fileName contentType } } }
                }
              }`,
              { id: req.id },
            );
            const request = (detail as any)?.request;
            if (!request) return;

            const noteMessages = (request.notes?.edges ?? [])
              .map((e: any) => e.node?.message)
              .filter((m: unknown): m is string => typeof m === 'string' && (m as string).trim().length > 0);
            const description = noteMessages.join('\n\n');
            const imageUrls = (request.noteAttachments?.edges ?? [])
              .filter((e: any) => e.node?.contentType?.startsWith('image/'))
              .map((e: any) => e.node.url);
            const clientName = request.companyName || request.contactName
              || (request.client ? `${request.client.firstName || ''} ${request.client.lastName || ''}`.trim() || request.client.companyName : null)
              || null;

            await db.prepare(
              `INSERT INTO jobber_webhook_requests
                (id, jobber_request_id, topic, account_id, title, client_name, description, request_body, image_urls, raw_payload, processed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (jobber_request_id, topic) DO UPDATE SET
                 title = excluded.title,
                 client_name = excluded.client_name,
                 description = excluded.description,
                 request_body = excluded.request_body,
                 image_urls = excluded.image_urls,
                 processed_at = excluded.processed_at`
            ).bind(
              crypto.randomUUID(), req.id, 'API_FETCH', '',
              request.title ?? null, clientName, description || null,
              JSON.stringify(request), JSON.stringify(imageUrls),
              JSON.stringify({ source: 'background_enrichment' }), new Date().toISOString(),
            ).run();

            console.log(`[quotes/requests] Enriched request ${req.id}`);
          } catch (err) {
            console.error(`[quotes/requests] Enrichment failed for ${req.id}:`, err instanceof Error ? err.message : err);
          }
        })
      )
    );
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
