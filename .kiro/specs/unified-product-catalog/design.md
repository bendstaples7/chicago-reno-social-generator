# Design: Unified Product Catalog

## Overview

Replace the fragmented catalog system (Jobber API + `manual_catalog_entries` + `catalog_keywords`) with a single `product_catalog` D1 table. All products live in one place with name, price, description, category, sort order, and keywords. Jobber becomes a sync source that upserts into this table rather than a live catalog provider.

## Database

### New Table: `product_catalog`

```sql
CREATE TABLE product_catalog (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    category TEXT,
    sort_order INTEGER NOT NULL DEFAULT 500,
    keywords TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    jobber_active INTEGER NOT NULL DEFAULT 1,
    locally_modified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);
CREATE INDEX idx_product_catalog_user ON product_catalog(user_id, sort_order);
```

### Tables to Deprecate

- `manual_catalog_entries` — replaced by `product_catalog`
- `catalog_keywords` — keywords now live on `product_catalog.keywords`

## Jobber Sync

The `JobberIntegration.syncProductCatalog(db, userId)` method:

1. Fetches all products from Jobber GraphQL API (existing pagination logic)
2. For each product, inserts into `product_catalog` only if no row with that (user_id, name) exists:
   - Uses `INSERT INTO ... ON CONFLICT(user_id, name) DO NOTHING` — existing products are never touched
   - New products get Jobber's price/description/category, sort_order=500, keywords=NULL, source='jobber', jobber_active=1
3. After inserting new products, updates `jobber_active`: set to 1 for products in the Jobber response, 0 for Jobber-sourced products not in the response

### Field Ownership

All fields are app-owned once a product exists. Jobber only provides the initial import.

| Field | On Initial Import | After Import |
|-------|------------------|--------------|
| unit_price | From Jobber | App-owned, editable |
| description | From Jobber | App-owned, editable |
| category | From Jobber | App-owned, editable |
| sort_order | Default 500 | App-owned, editable |
| keywords | NULL | App-owned, editable |
| jobber_active | 1 | Updated by sync (only field Jobber can change after import) |

### Sync Triggers

- **Login systems check**: after Jobber OAuth verification, sync products
- **GET /catalog**: sync before returning (with short TTL cache to avoid syncing every request)

## Catalog Access

### Single Fetch Function

```typescript
async function fetchCatalog(db: D1Database, userId: string): Promise<ProductCatalogEntry[]> {
  const result = await db.prepare(
    'SELECT id, name, unit_price, description, category, sort_order, keywords, source FROM product_catalog WHERE user_id = ? ORDER BY sort_order ASC, name ASC'
  ).bind(userId).all();
  // map rows to ProductCatalogEntry
}
```

Replaces: `fetchManualCatalog`, `mergeCatalogKeywords`, and the Jobber-vs-manual source selection logic.

### Simplified Quote Generation Flow

```
1. fetchCatalog(db, userId)           ← one call, one table
2. filterCatalogByKeywords(catalog)   ← keywords already on rows
3. buildPrompt(catalog)               ← sort order already on rows
4. AI generates line items
5. Rules engine runs
6. sortLineItemsByCatalog(items, catalog)  ← sort order works
7. Return draft
```

## API Changes

| Endpoint | Change |
|----------|--------|
| GET /catalog | Read from `product_catalog`, trigger Jobber sync if stale |
| POST /catalog | Bulk insert into `product_catalog` |
| PATCH /catalog/:id | Update `product_catalog` row |
| PUT /catalog/reorder | Update sort_order in `product_catalog` |
| POST /generate | Use `fetchCatalog()` instead of source selection logic |
| POST /drafts/:id/revise | Same simplification |

## Type Changes

The `source` field on `ProductCatalogEntry` becomes informational metadata rather than a behavioral switch. No structural type changes needed.

## Migration Strategy

1. Create `product_catalog` table
2. Seed script merges existing data: Jobber products + sort_order from `manual_catalog_entries` + keywords from `catalog_keywords`
3. Update all code to read from `product_catalog`
4. Keep old tables temporarily for rollback safety
5. Drop old tables in a future migration

## Scripts

- `seed-unified-catalog.mjs` — one-time migration of existing data into `product_catalog`
- `sync-catalog.mjs` — pull/push `product_catalog` between local and production D1
- Update `generate-keywords.mjs` to write directly to `product_catalog.keywords`
