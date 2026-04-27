# Implementation Plan: Quote Action Items

## Overview

This plan implements the Action Items feature for the quote generation workflow. Action items are callouts attached to line items that need additional user input (measurements, quantities) before the quote can be finalized. The implementation follows an incremental approach: shared types first, then database migration, backend services, route validation, and finally the client UI panel.

## Tasks

- [x] 1. Add ActionItem type to shared types
  - [x] 1.1 Add ActionItem interface and update QuoteDraft/QuoteDraftUpdate types
    - Add `ActionItem` interface to `shared/src/types/quote.ts` with fields: `id` (string), `quoteDraftId` (string), `lineItemId` (string), `description` (string), `completed` (boolean)
    - Add optional `actionItems?: ActionItem[]` field to the `QuoteDraft` interface
    - Add optional `actionItems?: Partial<ActionItem>[]` field to the `QuoteDraftUpdate` interface
    - Export `ActionItem` from `shared/src/types/index.ts`
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. Create database migration for action_items table
  - [x] 2.1 Create migration file `worker/src/migrations/0024_action_items.sql`
    - Create `action_items` table with columns: `id` TEXT PRIMARY KEY, `quote_draft_id` TEXT NOT NULL (FK to quote_drafts with ON DELETE CASCADE), `line_item_id` TEXT NOT NULL, `description` TEXT NOT NULL, `completed` INTEGER NOT NULL DEFAULT 0, `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
    - Create index `idx_action_items_draft_id` on `action_items(quote_draft_id)`
    - _Requirements: 2.1, 2.3_

- [x] 3. Extend QuoteEngine to detect and output action items
  - [x] 3.1 Update AI prompt and response parsing in QuoteEngine
    - Add action item detection rules to `SYSTEM_PROMPT` in `worker/src/services/quote-engine.ts` instructing the AI to identify line items needing measurements/quantities not in the customer request
    - Extend the `AIResponse` interface to include `actionItems?: AIActionItem[]` where `AIActionItem` has `lineItemProductName` and `description`
    - Update `parseAIResponse` to extract the `actionItems` array from AI output (graceful degradation: treat malformed/missing as empty array)
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.2 Map AI action items to ActionItem objects in buildDraft
    - In `buildDraft()`, after constructing line items, iterate over `aiResult.actionItems` and match each `lineItemProductName` to a line item's `productName`
    - Create `ActionItem` objects with new UUID, draft ID, matched line item ID, description, and `completed: false`
    - Discard action items that don't match any line item
    - Attach the resulting array to `draft.actionItems`
    - _Requirements: 1.4, 1.5_

- [x] 4. Update QuoteDraftService for action item persistence
  - [x] 4.1 Update save() to persist action items
    - In `QuoteDraftService.save()`, after inserting line items, insert each action item from `draft.actionItems` into the `action_items` table
    - _Requirements: 2.1_

  - [x] 4.2 Update getById() and list() to fetch action items
    - Add a `fetchActionItems(draftId)` private helper that queries `action_items` table and maps rows to `ActionItem[]`
    - Call `fetchActionItems` in `getById()` and `list()`, attach result to the returned `QuoteDraft`
    - _Requirements: 2.2_

  - [x] 4.3 Update update() to handle action item replacement
    - When `updates.actionItems` is provided in `update()`, delete existing action items for the draft and insert the new set
    - When `updates.actionItems` is not provided, leave existing action items unchanged
    - _Requirements: 6.1, 6.2_

  - [x] 4.4 Update delete() to remove action items
    - Add `DELETE FROM action_items WHERE quote_draft_id = ?` to the batch in `delete()`
    - _Requirements: 2.4_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Extend RevisionEngine and revision route for action items
  - [x] 6.1 Update RevisionEngine prompt and output to include action items
    - Extend the revision `SYSTEM_PROMPT` with the same action item detection rules as QuoteEngine
    - Add `actionItems?: AIActionItem[]` to the parsed revision output
    - Return action items in `RevisionOutput`
    - _Requirements: 7.1_

  - [x] 6.2 Implement completion preservation merge logic in revision route
    - In `worker/src/routes/quotes.ts` `POST /drafts/:id/revise` handler, after revision engine returns, build `ActionItem` objects from AI output by matching `lineItemProductName` to revised line items
    - Implement `mergeActionItems(oldItems, newItems)` that preserves `completed: true` for items matching on `lineItemId` + `description`
    - Include merged action items in the `quoteDraftService.update()` call
    - _Requirements: 7.2, 7.3_

- [x] 7. Add route validation for action items on PUT /drafts/:id
  - [x] 7.1 Validate action item payloads in the PUT /drafts/:id route handler
    - Extend the body type in `PUT /drafts/:id` to accept `actionItems`
    - Before passing to `quoteDraftService.update()`, validate each action item: `id` must be non-empty string, `lineItemId` must be non-empty string, `description` must be non-empty string, `completed` must be boolean
    - If validation fails, throw `PlatformError` with severity `error`, component `QuoteRoutes`, descriptive message, and recommended action
    - _Requirements: 6.3, 6.4_

- [x] 8. Implement Action Items Panel on the client
  - [x] 8.1 Update client API types for action items
    - Ensure `ActionItem` is imported from `shared` in `client/src/api.ts`
    - Verify `QuoteDraftUpdate` type includes `actionItems` field (comes from shared types)
    - _Requirements: 5.2, 5.3_

  - [x] 8.2 Build the Action Items Panel UI in QuoteDraftPage
    - Add an Action Items Panel section in `client/src/pages/QuoteDraftPage.tsx` rendered when `draft.actionItems` has items
    - Panel heading: "📋 Action Items ({incompleteCount} remaining)"
    - Each item shows: checkbox, product name (looked up from line items by `lineItemId`), description text
    - Completed items render with strikethrough and muted opacity
    - Hide panel when `draft.actionItems` is empty or undefined
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 8.3 Implement optimistic checkbox toggle with error rollback
    - On checkbox click, immediately update local `draft` state with toggled `completed` value
    - Call `updateDraft(id, { actionItems: updatedActionItems })` to persist
    - On failure, revert local state to previous value and show error via existing toast system
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ]* 10. Property-based tests for action item correctness properties
  - [ ]* 10.1 Write property test for line item reference validity
    - **Property 1: Action item line item reference validity**
    - Generate random drafts with action items using fast-check, verify every `lineItemId` references an existing line item in the draft's `lineItems` or `unresolvedItems`
    - **Validates: Requirements 1.4**

  - [ ]* 10.2 Write property test for default incomplete status
    - **Property 2: New action items default to incomplete**
    - Generate action items from engine output parsing logic, verify all have `completed === false`
    - **Validates: Requirements 1.5**

  - [ ]* 10.3 Write property test for persistence round-trip
    - **Property 3: Action item persistence round-trip**
    - Save and load drafts with action items using mock D1, verify field equality for all action item fields
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 10.4 Write property test for incomplete count accuracy
    - **Property 4: Incomplete count accuracy**
    - Generate random completion states, verify computed incomplete count equals items where `completed === false`
    - **Validates: Requirements 3.5**

  - [ ]* 10.5 Write property test for validation rejection
    - **Property 5: Validation rejects invalid action item payloads**
    - Generate invalid payloads (missing fields, wrong types), verify the validation function rejects them
    - **Validates: Requirements 6.3, 6.4**

  - [ ]* 10.6 Write property test for revision replacement
    - **Property 6: Revision replaces previous action items**
    - Simulate old + new action item sets, verify old items are fully replaced by new set
    - **Validates: Requirements 7.2**

  - [ ]* 10.7 Write property test for completion preservation on revision
    - **Property 7: Revision preserves completed status for matching items**
    - Simulate revision with matching items (same `lineItemId` + `description`), verify completed status carries forward
    - **Validates: Requirements 7.3**

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation language is TypeScript throughout (matching the existing monorepo)
- All property tests go in `tests/property/quote-action-items.property.test.ts` using fast-check
