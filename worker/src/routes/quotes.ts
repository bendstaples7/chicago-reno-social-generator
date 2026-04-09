import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import type { User, ProductCatalogEntry, QuoteTemplate } from 'shared';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import {
  QuoteEngine,
  JobberIntegration,
  QuoteDraftService,
  ActivityLogService,
} from '../services/index.js';

const app = new Hono<{ Bindings: Bindings; Variables: { user: User } }>();

app.use('*', sessionMiddleware);

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

  const activityLog = new ActivityLogService(db);
  const jobberIntegration = new JobberIntegration(activityLog, {
    clientId: c.env.JOBBER_CLIENT_ID || '',
    clientSecret: c.env.JOBBER_CLIENT_SECRET || '',
    accessToken: c.env.JOBBER_ACCESS_TOKEN || '',
    apiUrl: c.env.JOBBER_API_URL || undefined,
  });
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
  );

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
 * GET /catalog
 * Get the current product catalog (from Jobber or manual entries).
 */
app.get('/catalog', async (c) => {
  const db = c.env.DB;
  const userId = c.get('user').id;
  const activityLog = new ActivityLogService(db);
  const jobberIntegration = new JobberIntegration(activityLog, {
    clientId: c.env.JOBBER_CLIENT_ID || '',
    clientSecret: c.env.JOBBER_CLIENT_SECRET || '',
    accessToken: c.env.JOBBER_ACCESS_TOKEN || '',
    apiUrl: c.env.JOBBER_API_URL || undefined,
  });

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
  const activityLog = new ActivityLogService(db);
  const jobberIntegration = new JobberIntegration(activityLog, {
    clientId: c.env.JOBBER_CLIENT_ID || '',
    clientSecret: c.env.JOBBER_CLIENT_SECRET || '',
    accessToken: c.env.JOBBER_ACCESS_TOKEN || '',
    apiUrl: c.env.JOBBER_API_URL || undefined,
  });

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
 * GET /jobber/status
 * Check Jobber API availability.
 */
app.get('/jobber/status', (c) => {
  const activityLog = new ActivityLogService(c.env.DB);
  const jobberIntegration = new JobberIntegration(activityLog, {
    clientId: c.env.JOBBER_CLIENT_ID || '',
    clientSecret: c.env.JOBBER_CLIENT_SECRET || '',
    accessToken: c.env.JOBBER_ACCESS_TOKEN || '',
    apiUrl: c.env.JOBBER_API_URL || undefined,
  });
  return c.json({ available: jobberIntegration.isAvailable() });
});

export default app;
