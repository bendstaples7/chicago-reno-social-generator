# Implementation Plan: Jobber GraphQL Integration

## Overview

Replace the broken REST-based Jobber integration with a working GraphQL implementation across both server (Express/Postgres) and worker (Hono/D1). This involves rewriting the `JobberIntegration` class to use GraphQL queries, adding cursor-based pagination, introducing a new `fetchCustomerRequests` method, updating shared types and database schema, adding a new API endpoint, and building a `RequestSelector` UI component.

## Tasks

- [x] 1. Add shared types and update exports
  - [x] 1.1 Add `JobberCustomerRequest` interface to `shared/src/types/quote.ts`
    - Add `JobberCustomerRequest` with fields: `id`, `title`, `clientName`, `description`, `createdAt`
    - Add optional `jobberRequestId: string | null` field to the `QuoteDraft` interface
    - _Requirements: 7.1, 7.2_
  - [x] 1.2 Verify `JobberCustomerRequest` is exported from `shared/src/types/index.ts` and `shared/src/index.ts`
    - The existing barrel exports (`export * from './quote'`) should cover this automatically; confirm and fix if needed
    - _Requirements: 7.3_

- [x] 2. Add database migrations for `jobber_request_id` column
  - [x] 2.1 Create server migration `server/src/migrations/004_jobber_graphql.sql`
    - `ALTER TABLE quote_drafts ADD COLUMN jobber_request_id VARCHAR(255);`
    - _Requirements: 6.2_
  - [x] 2.2 Create worker migration `worker/src/migrations/0003_jobber_graphql.sql`
    - `ALTER TABLE quote_drafts ADD COLUMN jobber_request_id TEXT;`
    - _Requirements: 6.2_

- [x] 3. Rewrite server `JobberIntegration` to use GraphQL
  - [x] 3.1 Replace `apiRequest` with `graphqlRequest` in `server/src/services/jobber-integration.ts`
    - Change from `GET` to `POST` against `https://api.getjobber.com/api/graphql`
    - Send JSON body with `query` and `variables` fields
    - Set headers: `Authorization: Bearer <token>`, `Content-Type: application/json`, `X-JOBBER-GRAPHQL-VERSION: 2025-04-16`
    - Keep 10-second `AbortController` timeout
    - Parse response: check for `errors` array, extract `data` field
    - Throw on HTTP errors (401, 429, 5xx), GraphQL errors, or missing `data`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.1, 9.4_
  - [x] 3.2 Add `fetchAllPages` pagination helper
    - Implement cursor-based pagination following `pageInfo.hasNextPage` / `pageInfo.endCursor`
    - Accept a `connectionPath` array to navigate the response to the connection object
    - Extract `edges[].node` into an accumulator, loop until `hasNextPage` is false
    - Default page size: 50
    - _Requirements: 2.2, 3.2, 4.2_
  - [x] 3.3 Update `fetchProductCatalog` to use `productsAndServices` GraphQL query
    - Write the `productsAndServices` query requesting `id`, `name`, `description`, `defaultUnitCost`, `category`
    - Map `defaultUnitCost` → `unitPrice`, set `source: 'jobber'`
    - Keep existing cache logic and error handling (sets `available = false` on failure)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 9.3_
  - [x] 3.4 Update `fetchTemplateLibrary` to use `quotes` GraphQL query
    - Write the `quotes` query requesting `id`, `quoteNumber`, `title`, `message`, `quoteStatus`
    - Map `title || "Quote #" + quoteNumber` → `name`, `message` → `content`, set `source: 'jobber'`
    - Keep existing cache logic and error handling
    - _Requirements: 3.1, 3.3, 3.4, 3.5_
  - [x] 3.5 Add `fetchCustomerRequests` method
    - Write the `requests` query requesting `id`, `title`, `companyName`, `contactName`, `createdAt`, and `notes(first: 1)` for description
    - Map to `JobberCustomerRequest`: `clientName = companyName || contactName || "Unknown"`, `description = notes.edges[0]?.node?.message || ""`
    - Sort results by `createdAt` descending
    - Add `customerRequestsCache` field with same TTL pattern
    - On failure: log error, return `[]`, do NOT set `available = false`
    - Update `invalidateCache` to also clear `customerRequestsCache`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 3.6 Write unit tests for server `JobberIntegration` GraphQL methods
    - Test `graphqlRequest` sends correct POST body and headers
    - Test pagination helper accumulates nodes across pages
    - Test `fetchCustomerRequests` maps response correctly and does not set `available = false` on failure
    - Test error handling for 401, 429, timeout, and malformed responses
    - _Requirements: 1.1–1.5, 8.1, 8.2, 8.4, 9.1–9.4_

- [x] 4. Checkpoint — Verify server JobberIntegration compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Rewrite worker `JobberIntegration` to use GraphQL
  - [x] 5.1 Replace `apiRequest` with `graphqlRequest` in `worker/src/services/jobber-integration.ts`
    - Mirror the server implementation but keep the constructor pattern (config via constructor params)
    - Same POST body, headers, timeout, and error handling as server
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 9.1, 9.4_
  - [x] 5.2 Add `fetchAllPages` pagination helper to worker
    - Same logic as server implementation
    - _Requirements: 2.2, 3.2, 4.2_
  - [x] 5.3 Update worker `fetchProductCatalog` to use GraphQL
    - Same query and mapping as server
    - _Requirements: 2.1, 2.3, 2.4, 2.5_
  - [x] 5.4 Update worker `fetchTemplateLibrary` to use GraphQL
    - Same query and mapping as server
    - _Requirements: 3.1, 3.3, 3.4, 3.5_
  - [x] 5.5 Add `fetchCustomerRequests` method to worker
    - Same query, mapping, cache, and error handling as server
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 6. Checkpoint — Verify worker JobberIntegration compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update QuoteDraftService to handle `jobberRequestId`
  - [x] 7.1 Update server `QuoteDraftService` in `server/src/services/quote-draft-service.ts`
    - Add `jobber_request_id` to INSERT and SELECT queries
    - Map `jobber_request_id` in `mapDraftRow`
    - _Requirements: 6.2_
  - [x] 7.2 Update worker `QuoteDraftService` in `worker/src/services/quote-draft-service.ts`
    - Add `jobber_request_id` to INSERT and SELECT queries
    - Map `jobber_request_id` in `mapDraftRow`
    - _Requirements: 6.2_

- [x] 8. Update quote routes for both server and worker
  - [x] 8.1 Add `GET /jobber/requests` endpoint to `server/src/routes/quotes.ts`
    - Call `jobberIntegration.fetchCustomerRequests()`
    - Return `{ requests: JobberCustomerRequest[], available: boolean }`
    - If `isAvailable()` is false, return `{ requests: [], available: false }`
    - _Requirements: 6.3, 6.4_
  - [x] 8.2 Update `POST /generate` in `server/src/routes/quotes.ts` to accept `jobberRequestId`
    - Extract optional `jobberRequestId` from request body
    - Pass it through to `quoteDraftService.save()` on the draft object
    - _Requirements: 6.1, 6.2_
  - [x] 8.3 Add `GET /jobber/requests` endpoint to `worker/src/routes/quotes.ts`
    - Same behavior as server endpoint
    - _Requirements: 6.3, 6.4_
  - [x] 8.4 Update `POST /generate` in `worker/src/routes/quotes.ts` to accept `jobberRequestId`
    - Same behavior as server endpoint
    - _Requirements: 6.1, 6.2_

- [x] 9. Checkpoint — Verify routes compile and endpoints are wired
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Add client API functions and build RequestSelector UI
  - [x] 10.1 Add `fetchJobberRequests` function to `client/src/api.ts`
    - `GET /api/quotes/jobber/requests` → returns `{ requests: JobberCustomerRequest[], available: boolean }`
    - _Requirements: 6.3_
  - [x] 10.2 Update `generateQuote` in `client/src/api.ts` to accept `jobberRequestId`
    - Add optional `jobberRequestId?: string` to the data parameter
    - Include it in the POST body
    - _Requirements: 6.1_
  - [x] 10.3 Create `RequestSelector` component in `client/src/pages/RequestSelector.tsx`
    - Props: `onSelect`, `onClear`, `selectedRequestId`
    - On mount, call `fetchJobberRequests()`
    - Show loading spinner while fetching
    - On error, show inline message allowing manual text entry
    - Render list of requests with title, client name, and formatted date
    - Clicking a request calls `onSelect`; "Clear selection" button calls `onClear`
    - _Requirements: 5.2, 5.3, 5.5, 5.6, 5.7_
  - [x] 10.4 Update `QuoteInputPage` to integrate `RequestSelector`
    - Check Jobber availability on mount (existing `checkJobberStatus`)
    - If available, render `RequestSelector` above the textarea
    - On request selection: populate `customerText` with description, store `jobberRequestId`
    - Pass `jobberRequestId` to `generateQuote` call
    - On clear: reset `jobberRequestId`, allow free text editing
    - When Jobber unavailable, hide `RequestSelector` and show only manual text input
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 8.3_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Both server (Express/Postgres) and worker (Hono/D1) must be updated in parallel
- The design uses TypeScript throughout — no language selection needed
- No property-based tests are included since the design has no Correctness Properties section
- Each task references specific requirement clauses for traceability
- Checkpoints ensure incremental validation after each major component
