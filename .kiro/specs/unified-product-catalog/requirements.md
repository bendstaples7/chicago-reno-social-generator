# Requirements: Unified Product Catalog

## Introduction

The product catalog is currently split across three disconnected systems: the Jobber GraphQL API (live-fetched, no sort order or keywords), the `manual_catalog_entries` D1 table (has sort order and keywords but is empty in production), and the `catalog_keywords` D1 table (bridges keywords onto Jobber products by name). This fragmentation means sort orders configured in the UI don't apply in production, keywords require a separate merge step, and the system has two parallel code paths for catalog access.

This feature replaces all three with a single `product_catalog` table that is the sole source of truth for all products regardless of origin. Products can be imported from Jobber or created manually, but once stored they are treated identically — with name, price, description, category, sort order, and keywords all on the same row.

## Requirements

### Requirement 1: Single Catalog Table

**User Story:** As a user, I want one product catalog that works the same in production and local, so that sort orders and keywords I configure are always used during quote generation.

#### Acceptance Criteria

1. A `product_catalog` table SHALL store all products with columns: id, user_id, name, unit_price, description, category, sort_order, keywords, source, jobber_active, locally_modified_at, created_at, updated_at.
2. The `source` column SHALL accept values: 'jobber', 'manual', or any future source identifier.
3. Products SHALL be uniquely identified by (user_id, name) — no duplicate product names per user.
4. The table SHALL be the only place quote generation reads catalog data from.
5. `locally_modified_at` SHALL track when the product was last edited in the app, for future push-to-Jobber support.

### Requirement 2: Jobber Import as Sync

**User Story:** As a user, I want Jobber products automatically added to my catalog so I don't miss new products, but I don't want Jobber overwriting my local edits since the app will be more up to date.

#### Acceptance Criteria

1. When the Jobber API is available, the system SHALL check for new products not yet in `product_catalog` and insert them.
2. The sync SHALL NOT update any fields on products that already exist in `product_catalog`. Once a product is in the app, the app is the source of truth for all fields.
3. New products from Jobber SHALL be inserted with unit_price, description, and category from Jobber, sort_order defaulting to 500, keywords defaulting to NULL, and source set to 'jobber'.
4. Products that exist in `product_catalog` but are no longer in Jobber SHALL NOT be automatically deleted. A `jobber_active` flag SHALL indicate whether the product currently exists in Jobber.
5. The sync SHALL happen at most once per session (not on every API call).

### Requirement 3: Field Ownership Model

**User Story:** As a user, I want the app to be the source of truth for all product data, with Jobber only providing the initial import.

#### Acceptance Criteria

1. Once a product exists in `product_catalog`, ALL fields are app-owned. Jobber sync does not overwrite anything.
2. The app SHALL support editing all fields: name, price, description, category, sort_order, keywords.
3. **Future: Push to Jobber**: The schema SHALL support a future feature where app changes are pushed back to Jobber. This is NOT implemented in this spec but the data model must not preclude it (e.g., `locally_modified_at` timestamp for tracking dirty products).

### Requirement 4: Eliminate Parallel Code Paths

**User Story:** As a developer, I want one function to fetch the catalog instead of separate Jobber/manual paths with merge functions, so the code is simpler and behavior is consistent.

#### Acceptance Criteria

1. A single `fetchCatalog(db, userId)` function SHALL replace `fetchManualCatalog`, `mergeCatalogKeywords`, and the Jobber-vs-manual source selection logic.
2. The `filterCatalogByKeywords` function SHALL continue to work unchanged since keywords are on the product row.
3. The `sortLineItemsByCatalog` function SHALL continue to work unchanged since sort_order is on the product row.
4. The `catalogSource` field on quote drafts SHALL be removed or deprecated.

### Requirement 5: Catalog CRUD

**User Story:** As a user, I want to manage my catalog through the existing UI — reorder products, edit keywords, and see all products regardless of where they came from.

#### Acceptance Criteria

1. GET /catalog SHALL return all products from `product_catalog` ordered by sort_order.
2. PATCH /catalog/:id SHALL update name, description, keywords, and sort_order on any product. Editing Jobber-owned fields (price, description) SHALL set `locally_modified_at`.
3. PUT /catalog/reorder SHALL update sort_order values for all products.
4. POST /catalog SHALL support bulk import for manual product creation or CSV import.
5. The Product Ordering tab in the Rules page SHALL display and reorder products from the unified catalog.

### Requirement 6: Data Migration

**User Story:** As a user, I want my existing keywords and sort orders preserved when the system migrates to the unified catalog.

#### Acceptance Criteria

1. A migration script SHALL create the `product_catalog` table.
2. A seed script SHALL import existing data from `manual_catalog_entries` (with sort_order and keywords) and `catalog_keywords` (merging keywords by product name).
3. A sync script SHALL support pulling/pushing the catalog between local and production D1.

### Requirement 7: Jobber Sync Trigger

**User Story:** As a user, I want the Jobber product sync to happen automatically so my catalog stays current without manual intervention.

#### Acceptance Criteria

1. The Jobber product sync SHALL run during the systems check at login.
2. The sync SHALL also run on-demand when the user views the catalog page.
3. The sync SHALL be idempotent — running it multiple times produces the same result.

### Requirement 8: Stale Product Detection

**User Story:** As a user, I want to know which products are no longer in Jobber so I can clean up my catalog.

#### Acceptance Criteria

1. Products synced from Jobber SHALL have a `jobber_active` flag that is set to true during sync and false when the product is no longer returned by the Jobber API.
2. The UI SHOULD indicate which products are inactive in Jobber (future enhancement, not required for initial implementation).
3. Inactive products SHALL still be usable in quotes — they are not hidden or deleted automatically.
