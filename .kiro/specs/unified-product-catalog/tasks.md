# Tasks: Unified Product Catalog

## Overview

Replace the fragmented catalog system with a single `product_catalog` table. Jobber becomes a sync source, not a live catalog provider. Sort orders and keywords live on the product row.

## Tasks

- [x] 1. Create the database migration and seed script
  - [x] 1.1 Create migration `worker/src/migrations/0022_unified_product_catalog.sql`
    - Create `product_catalog` table with id, user_id, name, unit_price, description, category, sort_order, keywords, source, jobber_active, locally_modified_at, created_at, updated_at
    - Add UNIQUE constraint on (user_id, name)
    - Add index on (user_id, sort_order)
    - _Requirements: 1.1, 1.2, 1.3, 5.1_

  - [x] 1.2 Create `worker/scripts/seed-unified-catalog.mjs`
    - Fetch Jobber products via API (or read from CSV as fallback)
    - Merge sort_order from `manual_catalog_entries` by product name
    - Merge keywords from `catalog_keywords` by product name
    - Insert all products into `product_catalog`
    - Support --apply-local and --apply-remote flags
    - _Requirements: 5.2_

- [x] 2. Add Jobber sync-to-D1 capability
  - [x] 2.1 Add `syncProductCatalog(db, userId)` method to `JobberIntegration`
    - Fetch all products from Jobber GraphQL API
    - Insert new products using INSERT ... ON CONFLICT(user_id, name) DO NOTHING — never overwrite existing
    - New products get Jobber's price/description/category, sort_order=500, keywords=NULL, source='jobber', jobber_active=1
    - After insert, update jobber_active: 1 for products in Jobber response, 0 for Jobber-sourced products not in response
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 8.1_

  - [x] 2.2 Wire sync into login systems check and GET /catalog
    - Call `syncProductCatalog` during systems check (after Jobber OAuth)
    - Call `syncProductCatalog` in GET /catalog with a short TTL cache
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 3. Replace catalog access with single function
  - [x] 3.1 Create `fetchCatalog(db, userId)` in `worker/src/routes/quotes.ts`
    - Read from `product_catalog` ordered by sort_order ASC, name ASC
    - Map rows to `ProductCatalogEntry[]`
    - _Requirements: 3.1, 4.1_

  - [x] 3.2 Update POST /generate route
    - Replace source selection logic and `fetchManualCatalog`/`mergeCatalogKeywords` with `fetchCatalog`
    - Remove `catalogSource` from request body handling
    - _Requirements: 3.1, 3.4_

  - [x] 3.3 Update POST /drafts/:id/revise route
    - Same simplification as generate route
    - _Requirements: 3.1_

  - [x] 3.4 Update GET /catalog route
    - Read from `product_catalog` via `fetchCatalog`
    - Trigger Jobber sync if stale before returning
    - _Requirements: 4.1_

- [x] 4. Update catalog CRUD endpoints
  - [x] 4.1 Update PATCH /catalog/:id to write to `product_catalog`
    - Set `locally_modified_at` when editing Jobber-owned fields (price, description)
    - _Requirements: 5.2_

  - [x] 4.2 Update PUT /catalog/reorder to write sort_order to `product_catalog`
    - _Requirements: 4.3_

  - [x] 4.3 Update POST /catalog to insert into `product_catalog`
    - _Requirements: 4.4_

- [x] 5. Update rules service
  - [x] 5.1 Update `RulesService.updateCatalogSortOrders()` to write to `product_catalog`
  - [x] 5.2 Update catalog name lookups in rule generation to read from `product_catalog`

- [x] 6. Clean up removed code
  - [x] 6.1 Remove `fetchManualCatalog`, `mergeCatalogKeywords`, and source selection logic
  - [x] 6.2 Remove or deprecate `catalogSource` from quote draft save/read
    - _Requirements: 3.1, 3.4_

- [x] 7. Update scripts
  - [x] 7.1 Update `generate-keywords.mjs` to write to `product_catalog.keywords`
  - [x] 7.2 Create `sync-catalog.mjs` for local/production D1 sync
    - _Requirements: 5.3_
  - [x] 7.3 Update `dev.mjs` to include catalog sync in startup

- [x] 8. Verify and test
  - [x] 8.1 Run all existing tests
  - [x] 8.2 Test locally: generate a quote, verify sort order and keywords work
  - [x] 8.3 Test: create a rule with placeAfter, verify sort_order updates in `product_catalog`

## Notes

- Old tables (`manual_catalog_entries`, `catalog_keywords`) kept temporarily for rollback
- `source` field becomes informational — no longer drives code paths
- `filterCatalogByKeywords` and `sortLineItemsByCatalog` need no changes
