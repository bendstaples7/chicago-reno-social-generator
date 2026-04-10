# Implementation Plan: Quote Generation

## Overview

Add a quote generation workflow to the social media cross-poster app. This involves restructuring the app shell with tab-based navigation, building a quote input form, integrating with the Jobber API (with manual fallback), implementing the server-side quote engine, and persisting/displaying draft quotes. Implementation follows the existing patterns: shared types, Express services, React pages, D1 database migrations, and Vitest tests.

## Tasks

- [x] 1. Define shared types and database schema
  - [x] 1.1 Create `shared/src/types/quote.ts` with all quote domain types
    - Define `ProductCatalogEntry`, `QuoteTemplate`, `QuoteLineItem`, `QuoteDraft`, `QuoteDraftUpdate` interfaces
    - Export from `shared/src/types/index.ts`
    - _Requirements: 3.5, 3.6, 3.7, 4.2, 4.4_

  - [x] 1.2 Create database migration `server/src/migrations/003_quote_generation.sql`
    - Create `quote_drafts`, `quote_line_items`, `quote_media`, `manual_catalog_entries`, `manual_templates` tables with indexes
    - _Requirements: 7.1, 6.2_

- [x] 2. Implement Jobber Integration service
  - [x] 2.1 Create `server/src/services/jobber-integration.ts`
    - Implement OAuth 2.0 authentication using env vars (`JOBBER_CLIENT_ID`, `JOBBER_CLIENT_SECRET`, `JOBBER_ACCESS_TOKEN`)
    - Implement `fetchProductCatalog()` and `fetchTemplateLibrary()` with in-memory cache (configurable TTL, default 15 min)
    - Implement `isAvailable()` and `invalidateCache()`
    - Log errors via `ActivityLogService` and activate fallback on API failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 2.2 Write property test for cache TTL enforcement
    - **Property 10: Cache TTL enforcement**
    - **Validates: Requirements 5.4**

  - [ ]* 2.3 Write property test for API failure fallback
    - **Property 11: API failure triggers fallback**
    - **Validates: Requirements 5.5**

  - [ ]* 2.4 Write unit tests for `JobberIntegration`
    - Test cache hit/miss behavior, OAuth token refresh, error handling
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 3. Implement Quote Engine service
  - [x] 3.1 Create `server/src/services/quote-engine.ts`
    - Implement `generateQuote(input: QuoteEngineInput): Promise<QuoteEngineOutput>`
    - Analyze customer text and images using OpenAI (follow `ContentGenerator` pattern)
    - Match line items against product catalog, assign confidence scores (0-100)
    - Partition items: confidence >= 70 → matched, < 70 → unresolved
    - Search template library for matching template; use it as starting structure or build from scratch
    - Limit matches to existing catalog entries only (no new products)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 3.2 Write property test for confidence score range
    - **Property 4: Confidence score range invariant**
    - **Validates: Requirements 3.6**

  - [ ]* 3.3 Write property test for confidence threshold partitioning
    - **Property 5: Confidence threshold partitioning**
    - **Validates: Requirements 3.7**

  - [ ]* 3.4 Write property test for catalog reference integrity
    - **Property 6: Catalog reference integrity**
    - **Validates: Requirements 3.5, 3.8**

  - [ ]* 3.5 Write property test for template selection consistency
    - **Property 7: Template selection consistency**
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 3.6 Write unit tests for `QuoteEngine`
    - Test with known catalog + request text, verify correct matching structure
    - Test fallback parsing when AI response is malformed
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 4. Implement Quote Draft persistence service
  - [x] 4.1 Create `server/src/services/quote-draft-service.ts`
    - Implement `save()`, `getById()`, `list()`, `update()`, `delete()` methods
    - `list()` returns drafts sorted by creation date descending (newest first)
    - Handle line items and media associations in transactions
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 4.2 Write property test for draft persistence round-trip
    - **Property 14: Draft persistence round-trip**
    - **Validates: Requirements 7.1**

  - [ ]* 4.3 Write property test for draft list ordering
    - **Property 15: Draft list ordering**
    - **Validates: Requirements 7.2**

  - [ ]* 4.4 Write property test for draft deletion
    - **Property 16: Draft deletion**
    - **Validates: Requirements 7.4**

  - [ ]* 4.5 Write unit tests for `QuoteDraftService`
    - Test CRUD operations, verify database queries, test edge cases
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. Checkpoint - Ensure all server-side tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create Quote API routes and wire server services
  - [x] 6.1 Create `server/src/routes/quotes.ts` with all quote endpoints
    - `POST /api/quotes/generate` — submit customer request, generate draft
    - `GET /api/quotes/drafts` — list saved drafts
    - `GET /api/quotes/drafts/:id` — get single draft
    - `PUT /api/quotes/drafts/:id` — update draft
    - `DELETE /api/quotes/drafts/:id` — delete draft
    - `GET /api/quotes/catalog` — get product catalog
    - `POST /api/quotes/catalog` — save manual catalog entries
    - `GET /api/quotes/templates` — get template library
    - `POST /api/quotes/templates` — save manual templates
    - `GET /api/quotes/jobber/status` — check Jobber API availability
    - _Requirements: 3.1, 5.2, 5.3, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 6.2 Register quote routes in `server/src/index.ts` and export new services from `server/src/services/index.ts`
    - Add `app.use('/api/quotes', quoteRoutes)` to server entry
    - Export `QuoteEngine`, `JobberIntegration`, `QuoteDraftService` from services index
    - _Requirements: 3.1, 5.2_

- [x] 7. Restructure App Shell with tab-based navigation
  - [x] 7.1 Modify `client/src/Layout.tsx` to add top-level tab bar
    - Add "Social Media" and "Quotes" tabs above the existing sidebar
    - Persist last active tab to `localStorage` under key `app_active_tab`
    - On load, default to last active tab or "Social Media" if no stored state
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 7.2 Restructure `client/src/App.tsx` routing for tab sections
    - Group existing pages under `/social/*` route prefix
    - Add `/quotes/*` route group for quote generation pages
    - Preserve navigation state within each section when switching tabs
    - Update default redirect to `/social/dashboard`
    - _Requirements: 1.2, 1.3, 1.4_

- [x] 8. Build Quote Input Form page
  - [x] 8.1 Create `client/src/pages/QuoteInputPage.tsx`
    - Multi-line text area for customer request text
    - Image upload area accepting JPEG, PNG, HEIC, WebP (max 10 images)
    - "Generate Quote" button enabled when text is non-empty or at least one image uploaded
    - Inline error for invalid file types (identify rejected file, list accepted formats)
    - Inline error when exceeding 10 image limit
    - Loading indicator while generating
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.6_

  - [ ]* 8.2 Write property test for Generate Quote button enablement
    - **Property 1: Generate Quote button enablement**
    - **Validates: Requirements 2.4**

  - [ ]* 8.3 Write property test for image count validation
    - **Property 2: Image count validation**
    - **Validates: Requirements 2.3, 2.6**

  - [ ]* 8.4 Write property test for file type validation
    - **Property 3: File type validation**
    - **Validates: Requirements 2.5**

- [x] 9. Build Quote Draft Display page
  - [x] 9.1 Create `client/src/pages/QuoteDraftPage.tsx`
    - Display selected template name (if any)
    - Matched line items table: product name, quantity, unit price, confidence score
    - Unresolved items section with warning indicator, original text, and mismatch reason
    - Hide unresolved section when there are zero unresolved items
    - Loading indicator while engine processes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 9.2 Write property test for matched line item display completeness
    - **Property 8: Matched line item display completeness**
    - **Validates: Requirements 4.2**

  - [ ]* 9.3 Write property test for unresolved item display completeness
    - **Property 9: Unresolved item display completeness**
    - **Validates: Requirements 4.4**

- [x] 10. Build Saved Drafts List and Manual Fallback UI
  - [x] 10.1 Create `client/src/pages/QuoteDraftsListPage.tsx`
    - List saved drafts sorted by creation date (newest first)
    - Click to load a draft for review
    - Delete action per draft
    - _Requirements: 7.2, 7.3, 7.4_

  - [x] 10.2 Create `client/src/pages/ManualFallbackPage.tsx`
    - Product entry form: name, unit price, description
    - Add/edit/remove products from local catalog
    - Template text editor for pasting quote templates
    - Notification banner when Jobber API becomes available again
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 10.3 Write property test for manual catalog CRUD round-trip
    - **Property 12: Manual catalog CRUD round-trip**
    - **Validates: Requirements 6.2**

  - [ ]* 10.4 Write property test for manual fallback catalog usage
    - **Property 13: Manual fallback catalog usage**
    - **Validates: Requirements 6.4**

- [x] 11. Add client API functions and wire quote pages
  - [x] 11.1 Add quote API functions to `client/src/api.ts`
    - `generateQuote()`, `fetchDrafts()`, `fetchDraft()`, `updateDraft()`, `deleteDraft()`
    - `fetchCatalog()`, `saveCatalog()`, `fetchTemplates()`, `saveTemplates()`
    - `checkJobberStatus()`
    - _Requirements: 3.1, 5.6, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 11.2 Register quote pages in `App.tsx` under `/quotes/*` routes
    - Wire `QuoteInputPage`, `QuoteDraftPage`, `QuoteDraftsListPage`, `ManualFallbackPage`
    - Add sub-navigation within the Quotes tab section
    - _Requirements: 1.3_

- [x] 12. Mirror server changes to Cloudflare Worker
  - [x] 12.1 Copy new services to `worker/src/services/`
    - Add `quote-engine.ts`, `jobber-integration.ts`, `quote-draft-service.ts`
    - Export from `worker/src/services/index.ts`
    - _Requirements: 3.1, 5.1, 7.1_

  - [x] 12.2 Create `worker/src/routes/quotes.ts` and register in `worker/src/index.ts`
    - Mirror all quote routes from server
    - Add D1 migration for quote tables in `worker/src/migrations/`
    - _Requirements: 3.1, 5.2, 7.1_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using `fast-check` with Vitest
- Unit tests validate specific examples and edge cases
- The worker mirror (task 12) keeps the Cloudflare deployment in sync with the Express server
