# Implementation Plan: Quote Feedback & Revision

## Overview

Implement iterative natural-language feedback and AI-powered revision for quote drafts. The implementation proceeds bottom-up: database migration → shared types → server service → server route → client API → client UI, with tests woven in alongside each layer.

## Tasks

- [x] 1. Database migration and shared types
  - [x] 1.1 Create migration `server/src/migrations/009_quote_revision_history.sql`
    - Create the `quote_revision_history` table with columns: `id` (UUID PK), `quote_draft_id` (UUID FK → quote_drafts ON DELETE CASCADE), `feedback_text` (TEXT NOT NULL), `created_at` (TIMESTAMP NOT NULL DEFAULT NOW())
    - Create index `idx_quote_revision_history_draft_id` on `quote_draft_id`
    - _Requirements: 5.1_

  - [x] 1.2 Add shared types to `shared/src/types/quote.ts`
    - Add `RevisionHistoryEntry` interface with fields: `id`, `quoteDraftId`, `feedbackText`, `createdAt`
    - Add optional `revisionHistory?: RevisionHistoryEntry[]` field to the existing `QuoteDraft` interface
    - Export `RevisionHistoryEntry` from `shared/src/types/index.ts` and `shared/src/index.ts`
    - _Requirements: 4.3, 5.1, 5.2_

- [x] 2. RevisionEngine service
  - [x] 2.1 Create `server/src/services/revision-engine.ts`
    - Implement `RevisionEngine` class with `revise(input: RevisionInput): Promise<RevisionOutput>` method
    - Define `RevisionInput` interface: `feedbackText`, `currentLineItems`, `currentUnresolvedItems`, `catalog`
    - Define `RevisionOutput` interface: `lineItems`, `unresolvedItems`
    - Build a system prompt instructing the AI to interpret feedback as delta operations on current line items (reorder, change quantity, adjust price, remove, add)
    - Build a user prompt containing current line items, catalog entries, and the feedback text
    - Call OpenAI API (`gpt-4o-mini`) with 30-second timeout via `AbortController`
    - Parse the JSON response, stripping markdown code fences if present
    - Validate catalog references: items referencing non-existent catalog IDs are downgraded to unresolved with `unmatchedReason`
    - Use catalog pricing for matched items (same pattern as `QuoteEngine.validateAIResponse`)
    - Partition items into resolved (confidence ≥ 70 and valid catalog ID) and unresolved
    - On parse failure, return original line items unchanged (fallback behavior per Requirement 6.2)
    - On timeout, throw `PlatformError` with timeout message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 6.2, 6.3_

  - [x] 2.2 Export `RevisionEngine` from `server/src/services/index.ts`
    - Add export for `RevisionEngine` class and `RevisionInput`/`RevisionOutput` types
    - _Requirements: 2.1_

  - [ ]* 2.3 Write property test: whitespace feedback rejection (Property 1)
    - **Property 1: Whitespace feedback rejection**
    - Generate random whitespace-only strings using `fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'))` filtered to non-empty
    - Verify that the validation logic rejects the input
    - File: `tests/property/quote-feedback-revision.property.test.ts`
    - **Validates: Requirements 1.4**

  - [ ]* 2.4 Write property test: revision output partitioning and catalog pricing (Property 2)
    - **Property 2: Revision output partitioning and catalog pricing**
    - Generate random line items with random catalog references, run through the validation/partitioning logic
    - Verify every item with a valid `productCatalogEntryId` has catalog pricing and is resolved; items without valid catalog match are unresolved with non-empty `unmatchedReason`
    - File: `tests/property/quote-feedback-revision.property.test.ts`
    - **Validates: Requirements 2.7, 2.8**

  - [ ]* 2.5 Write property test: unparseable AI response preserves original items (Property 6)
    - **Property 6: Unparseable AI response preserves original items**
    - Generate random non-JSON strings, pass to the RevisionEngine parse logic
    - Verify original line items and unresolved items are returned unchanged without throwing
    - File: `tests/property/quote-feedback-revision.property.test.ts`
    - **Validates: Requirements 6.2**

- [x] 3. Extend QuoteDraftService with revision history methods
  - [x] 3.1 Add `addRevisionEntry()` and `getRevisionHistory()` to `server/src/services/quote-draft-service.ts`
    - `addRevisionEntry(draftId, userId, feedbackText)`: inserts a row into `quote_revision_history` and returns the `RevisionHistoryEntry`
    - `getRevisionHistory(draftId)`: queries `quote_revision_history` for the draft, ordered by `created_at ASC`, returns `RevisionHistoryEntry[]`
    - Update `getById()` to also fetch and include `revisionHistory` on the returned `QuoteDraft`
    - _Requirements: 4.3, 5.1, 5.2, 5.3_

  - [ ]* 3.2 Write property test: revision history persistence round-trip (Property 4)
    - **Property 4: Revision history persistence round-trip**
    - Generate random non-empty, non-whitespace-only feedback strings
    - Persist via `addRevisionEntry()`, fetch via `getRevisionHistory()`, verify the entry contains the exact feedback text and a valid timestamp
    - File: `tests/property/quote-feedback-revision.property.test.ts`
    - **Validates: Requirements 4.3, 5.1**

  - [ ]* 3.3 Write property test: revision history chronological ordering (Property 5)
    - **Property 5: Revision history chronological ordering**
    - Generate multiple revision history entries with varying timestamps
    - Verify `getRevisionHistory()` returns entries sorted ascending by `createdAt`
    - File: `tests/property/quote-feedback-revision.property.test.ts`
    - **Validates: Requirements 5.3**

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. API route for draft revision
  - [x] 5.1 Add `POST /drafts/:id/revise` route to `server/src/routes/quotes.ts`
    - Validate `feedbackText` is non-empty after trimming; return 400 `PlatformError` if empty
    - Load the draft via `quoteDraftService.getById()` (verifies ownership)
    - Fetch the product catalog (reuse the same Jobber/manual/imported fallback logic from the generate route)
    - Call `revisionEngine.revise()` with current line items, unresolved items, catalog, and feedback text
    - Persist the revision history entry via `quoteDraftService.addRevisionEntry()`
    - Update the draft with revised line items via `quoteDraftService.update()`
    - Return the updated `QuoteDraft` (which now includes `revisionHistory`)
    - Instantiate `RevisionEngine` alongside the existing service instances at the top of the routes file
    - _Requirements: 1.2, 1.4, 2.1, 3.3, 4.3, 5.1, 6.1, 6.2, 6.3_

  - [ ]* 5.2 Write property test: revised line items persistence round-trip (Property 3)
    - **Property 3: Revised line items persistence round-trip**
    - Generate random `QuoteLineItem` arrays, persist via `QuoteDraftService.update()`, fetch via `getById()`, verify equivalent line items (same product names, quantities, unit prices, display order)
    - File: `tests/property/quote-feedback-revision.property.test.ts`
    - **Validates: Requirements 3.3**

- [x] 6. Client API function and QuoteDraftPage UI
  - [x] 6.1 Add `reviseDraft()` function to `client/src/api.ts`
    - `POST` to `/api/quotes/drafts/{draftId}/revise` with `{ feedbackText }` body
    - Returns `QuoteDraft` (which includes `revisionHistory`)
    - _Requirements: 1.2_

  - [x] 6.2 Update `QuoteDraftPage` with feedback input and revision history UI
    - Add state variables: `feedbackText`, `revising` (loading flag), `revisionError`
    - Add a text input area below the line items table for typing feedback
    - Add a "Submit Feedback" button, disabled when input is empty/whitespace-only or `revising` is true
    - Show inline validation message when user attempts to submit empty/whitespace feedback
    - Show a loading spinner and disable the input while revision is in progress
    - On successful revision: update `draft` state with the returned data, clear `feedbackText`, re-enable input
    - On error: display error message, re-enable input for retry
    - Add a "Revision History" section below the feedback input, shown only when `draft.revisionHistory` has entries
    - Display history entries in chronological order (oldest first) with feedback text and formatted timestamp
    - Style using inline `React.CSSProperties` consistent with the existing page styles
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 4.1, 4.2, 4.4, 5.2, 5.3, 6.1_

- [x] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `RevisionEngine` follows the same architectural pattern as the existing `QuoteEngine` (buildPrompt → OpenAI call → parse → validate)
