import { Router } from 'express';
import {
  QuoteEngine,
  JobberIntegration,
  QuoteDraftService,
  ActivityLogService,
} from '../services/index.js';
import { sessionMiddleware } from '../middleware/session.js';
import { PlatformError } from '../errors/index.js';
import { query } from '../config/database.js';
import type { ProductCatalogEntry, QuoteTemplate } from 'shared';

const router = Router();
const activityLog = new ActivityLogService();
const jobberIntegration = new JobberIntegration(activityLog);
const quoteEngine = new QuoteEngine();
const quoteDraftService = new QuoteDraftService();

// All quote routes require authentication
router.use(sessionMiddleware);

/**
 * POST /generate
 * Submit a customer request and generate a quote draft.
 */
router.post('/generate', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { customerText, mediaItemIds, catalogSource, manualCatalog, manualTemplates } = req.body as {
      customerText?: string;
      mediaItemIds?: string[];
      catalogSource?: 'jobber' | 'manual';
      manualCatalog?: ProductCatalogEntry[];
      manualTemplates?: QuoteTemplate[];
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

    const result = await quoteEngine.generateQuote(
      {
        customerText: customerText ?? '',
        mediaItemIds: mediaItemIds ?? [],
        userId,
        catalogSource: source,
        manualCatalog: source === 'manual' ? catalog : undefined,
        manualTemplates: source === 'manual' ? templates : undefined,
      },
      catalog,
      templates,
    );

    // Persist the draft
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
    let catalog: ProductCatalogEntry[];
    if (jobberIntegration.isAvailable()) {
      catalog = await jobberIntegration.fetchProductCatalog();
    }
    if (!jobberIntegration.isAvailable()) {
      catalog = await fetchManualCatalog(req.user!.id);
    }
    res.json({ catalog: catalog! });
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
    let templates: QuoteTemplate[];
    if (jobberIntegration.isAvailable()) {
      templates = await jobberIntegration.fetchTemplateLibrary();
    }
    if (!jobberIntegration.isAvailable()) {
      templates = await fetchManualTemplates(req.user!.id);
    }
    res.json({ templates: templates! });
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
 * GET /jobber/status
 * Check Jobber API availability.
 */
router.get('/jobber/status', (_req, res) => {
  res.json({ available: jobberIntegration.isAvailable() });
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
