    # Implementation Plan: Push Quote to Jobber

## Overview

This plan implements the ability to push a finalized quote draft from the app into Jobber as a real Jobber quote via the GraphQL API. The implementation proceeds bottom-up: database migration, shared types, push service, API route, and finally client UI. Each task builds on the previous, with property-based and unit tests wired in close to the code they validate.

## Tasks

- [x] 1. Database migration and shared type updates
  - [x] 1.1 Create database migration `worker/src/migrations/0013_jobber_quote_push.sql`
    - Add `jobber_quote_id TEXT DEFAULT NULL` column to `quote_drafts`
    - Add `jobber_quote_number TEXT DEFAULT NULL` column to `quote_drafts`
    - Follow existing migration naming convention (see `0012_system_user.sql`)
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 1.2 Update `QuoteDraft` interface in `shared/src/types/quote.ts`
    - Add `jobberQuoteId?: string | null` field
    - Add `jobberQuoteNumber?: string | null` field
    - Add `draftNumber` to the interface if not already present (verify current state)
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 1.3 Update `QuoteDraftService` to read and write the new columns
    - Update `save()` INSERT to include `jobber_quote_id` and `jobber_quote_number`
    - Update all SELECT queries in `getById()`, `list()`, `update()` to include the new columns
    - Update `mapDraftRow()` to map `jobber_quote_id` → `jobberQuoteId` and `jobber_quote_number` → `jobberQuoteNumber`
    - _Requirements: 1.1, 1.2, 5.2_

- [x] 2. Implement `JobberQuotePushService`
  - [x] 2.1 Create `worker/src/services/jobber-quote-push-service.ts` with class skeleton
    - Define `PushResult` interface (`jobberQuoteId`, `jobberQuoteNumber`)
    - Constructor accepts `D1Database` and `JobberIntegration`
    - Implement `pushToJobber(draft: QuoteDraft): Promise<PushResult>` orchestration method
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.2 Implement `resolveCustomerId` private method
    - First check D1 `jobber_webhook_requests` table for cached request with client info from `request_body` JSON
    - Fall back to live GraphQL query (`FetchRequestClient` query) via `jobberIntegration.graphqlRequest()`
    - Throw `PlatformError` if draft has no `jobberRequestId`
    - Throw `PlatformError` if request has no linked client
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 2.3 Implement `buildQuoteCreateInput` private method
    - Map resolved `lineItems` to Jobber line item format: `name` from `productName`, `quantity`, `unitPrice`, optional `productOrServiceId` from `productCatalogEntryId`
    - Set quote title to `"Draft D-{zero-padded draftNumber}"` (e.g., `"Draft D-001"`)
    - Build `message` field: include unresolved items' `originalText` if any exist
    - Preserve line item display order
    - Return `{ query, variables }` for the `quoteCreate` mutation
    - _Requirements: 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 2.4 Implement `persistPushResult` private method
    - UPDATE `quote_drafts` SET `jobber_quote_id`, `jobber_quote_number`, `status = 'finalized'`, `updated_at = datetime('now')` WHERE `id = ?`
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 2.5 Handle GraphQL `userErrors` in `pushToJobber`
    - After calling `quoteCreate` mutation, check for `userErrors` array in response
    - If `userErrors` is non-empty, throw `PlatformError` with the first error message
    - _Requirements: 3.5_

  - [x] 2.6 Export `JobberQuotePushService` from `worker/src/services/index.ts`
    - Add export to the barrel file
    - _Requirements: 3.1_

- [x] 3. Checkpoint — Verify service layer compiles
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 3.1 Write property test: Line item mapping completeness (Property 1)
    - **Property 1: Line item mapping completeness and field correctness**
    - Extract `buildLineItems` as a testable pure function (or test via `buildQuoteCreateInput`)
    - Generate arbitrary arrays of `QuoteLineItem` objects with fast-check
    - Assert output length equals input length, order preserved, `name`/`quantity`/`unitPrice` mapped correctly
    - Assert `productOrServiceId` present when `productCatalogEntryId` is non-null, absent otherwise
    - Minimum 100 runs
    - File: `tests/property/push-quote-to-jobber.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [ ]* 3.2 Write property test: Unresolved items preserved in quote message (Property 2)
    - **Property 2: Unresolved items preserved in quote message**
    - Generate arbitrary arrays of unresolved `QuoteLineItem` objects
    - Assert every item's `originalText` appears in the generated message when array is non-empty
    - Assert message has no unresolved item text when array is empty
    - Minimum 100 runs
    - File: `tests/property/push-quote-to-jobber.property.test.ts`
    - **Validates: Requirements 4.6**

- [ ]* 3.3 Write property test: Title traceability from draft number (Property 4)
    - **Property 4: Title traceability from draft number**
    - Generate arbitrary positive integers as draft numbers
    - Assert generated title contains `"D-"` followed by zero-padded draft number (e.g., 1 → `"D-001"`, 42 → `"D-042"`)
    - Minimum 100 runs
    - File: `tests/property/push-quote-to-jobber.property.test.ts`
    - **Validates: Requirements 3.4**

- [ ]* 3.4 Write property test: Push result persistence invariant (Property 3)
    - **Property 3: Push result persistence invariant**
    - Use mock D1 to simulate `persistPushResult`
    - Generate arbitrary `jobberQuoteId` and `jobberQuoteNumber` strings
    - Assert after persist: `jobber_quote_id` is non-null, `jobber_quote_number` is non-null, `status` is `'finalized'`
    - Assert before persist: both fields are null
    - Minimum 100 runs
    - File: `tests/property/push-quote-to-jobber.property.test.ts`
    - **Validates: Requirements 1.1, 1.2, 5.4**

- [ ]* 3.5 Write unit tests for `JobberQuotePushService`
    - Test push succeeds with valid draft and linked customer (mock GraphQL responses)
    - Test push fails when draft has no `jobberRequestId`
    - Test push fails when customer request has no linked client
    - Test push fails when draft is already finalized (status check in route)
    - Test GraphQL `userErrors` are propagated as `PlatformError`
    - Test unresolved items appear in quote message
    - Test line items with Jobber product IDs include `productOrServiceId`
    - Test line items without Jobber product IDs omit `productOrServiceId`
    - Test draft status updated to `'finalized'` after push
    - Test Jobber quote ID and number persisted to D1
    - File: `tests/unit/jobber-quote-push-service.test.ts`
    - _Requirements: 3.1, 3.5, 4.3, 4.6, 5.1, 5.2, 5.4, 8.3, 8.4_

- [x] 4. Add API route for push endpoint
  - [x] 4.1 Add `POST /drafts/:id/push` route in `worker/src/routes/quotes.ts`
    - Load draft via `QuoteDraftService.getById()` (verifies ownership)
    - Validate `draft.status === 'draft'` — throw `PlatformError` if already finalized
    - Validate `draft.jobberRequestId` is present — throw `PlatformError` if missing
    - Create `JobberQuotePushService` with D1 and `JobberIntegration` (use existing `createJobberIntegration` helper)
    - Call `pushToJobber(draft)` and re-fetch the updated draft
    - Return updated draft as JSON with 200 status
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.6_

- [x] 5. Add client API function and UI changes
  - [x] 5.1 Add `pushDraftToJobber` function in `client/src/api.ts`
    - `POST /api/quotes/drafts/{draftId}/push` with auth headers
    - Use `handleResponseWithToast` for error display
    - Return `QuoteDraft`
    - _Requirements: 2.1, 2.5_

  - [x] 5.2 Update `QuoteDraftPage.tsx` with "Push to Jobber" button and Jobber links
    - Add state variables: `pushing` (boolean), `pushError` (string | null)
    - Add "Push to Jobber" button below the revision section
    - Enable button when `status === 'draft'` and `jobberRequestId` is present
    - Show loading spinner + "Pushing to Jobber…" text while `pushing` is true
    - On success: update `draft` state with response (shows Jobber quote number, disables button)
    - On error: display error message below button, re-enable for retry
    - When `jobberQuoteId` is set: show Jobber quote number badge and disable button with "Already pushed" label
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.3_

  - [x] 5.3 Add Jobber links section to `QuoteDraftPage.tsx`
    - When `jobberQuoteId` is present: show clickable link to Jobber quote (`https://app.getjobber.com/quotes/{jobberQuoteNumber}` or similar deep link)
    - When `jobberRequestId` is present and request detail has `jobberWebUri`: show clickable link to customer request
    - All Jobber links open in new tab (`target="_blank"`, `rel="noopener noreferrer"`)
    - Display Jobber quote number alongside draft number in the title area (e.g., "Quote Draft D-001 · Jobber Q-42")
    - _Requirements: 1.3, 1.4, 6.1, 6.2, 6.3_

- [x] 6. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `JobberIntegration.graphqlRequest()` method already handles auth token refresh, throttle backoff, and timeouts — the push service reuses it
- All GraphQL interactions are mocked in tests — no live Jobber API calls in CI
