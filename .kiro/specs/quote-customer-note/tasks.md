# Implementation Plan: Quote Customer Note

## Overview

Add a `customerNote` field to the quote draft system, enabling users and the rules engine to attach a customer-facing message to quotes before publishing to Jobber. Implementation proceeds bottom-up: shared types → DB migration → service layer → rules engine → Jobber push → client UI → property tests.

## Tasks

- [x] 1. Update shared types
  - [x] 1.1 Add `customerNote` field to `QuoteDraft` and `QuoteDraftUpdate` interfaces in `shared/src/types/quote.ts`
    - Add `customerNote: string | null` to `QuoteDraft`
    - Add `customerNote?: string | null` to `QuoteDraftUpdate`
    - _Requirements: 9.1, 9.2_

  - [x] 1.2 Add new rule action types and variants to shared types
    - Add `set_customer_note` and `append_customer_note` to `RuleActionType` union
    - Add typed variants: `{ type: 'set_customer_note'; text: string }` and `{ type: 'append_customer_note'; text: string; separator?: string }`
    - _Requirements: 9.3, 9.4_

  - [x] 1.3 Add `customerNote` field to `RulesEngineResult` interface
    - Add `customerNote: string | null` to `RulesEngineResult`
    - _Requirements: 9.5_

- [x] 2. Database migration
  - [x] 2.1 Create migration file `worker/src/migrations/0025_customer_note.sql`
    - `ALTER TABLE quote_drafts ADD COLUMN customer_note TEXT DEFAULT NULL;`
    - _Requirements: 2.1, 2.2_

- [x] 3. QuoteDraftService persistence
  - [x] 3.1 Update `save()` to include `customer_note` column
    - Add `customer_note` to the INSERT column list, binding `draft.customerNote ?? null`
    - _Requirements: 1.2, 1.3_

  - [x] 3.2 Update `getById()` and `list()` to select `customer_note`
    - Add `customer_note` to SELECT column lists
    - Update `mapDraftRow()` to map `row.customer_note` → `customerNote`
    - _Requirements: 1.4, 3.3, 3.4_

  - [x] 3.3 Update `update()` to handle `customerNote` field
    - When `updates.customerNote !== undefined`, add `customer_note = ?` to SET clauses
    - When `customerNote` is omitted from the update payload, leave existing value unchanged
    - _Requirements: 3.1, 3.2_

  - [ ]* 3.4 Write property test: persistence round-trip
    - **Property 1: Customer note persistence round-trip**
    - **Validates: Requirements 1.3, 1.4, 3.1, 3.3**

  - [ ]* 3.5 Write property test: omitted field preservation
    - **Property 2: Omitted customerNote field preserves existing value**
    - **Validates: Requirements 3.2**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Rules engine — customer note actions
  - [x] 5.1 Add `set_customer_note` and `append_customer_note` action handlers to the rules engine
    - Track `customerNote: string | null` state in `executeRules`, initialized to `null`
    - For `set_customer_note`: set `customerNote = action.text`
    - For `append_customer_note`: if current is null/empty set to `action.text`, else append `separator + action.text`
    - Return `customerNote` on `RulesEngineResult`
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2_

  - [x] 5.2 Add validation for new action types in `validateAction`
    - `set_customer_note`: reject if `text` is not a non-empty string
    - `append_customer_note`: reject if `text` is not a non-empty string; reject if `separator` is provided but not a string
    - _Requirements: 5.4, 6.4_

  - [x] 5.3 Add audit trail entries for customer note actions
    - Use sentinel ID `__customer_note__` in before/after snapshots
    - `beforeSnapshot` reflects customerNote value before the action
    - `afterSnapshot` reflects customerNote value after the action
    - _Requirements: 10.1, 10.2_

  - [ ]* 5.4 Write property test: set_customer_note sets the value
    - **Property 3: set_customer_note sets the value**
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 5.5 Write property test: last-writer-wins for multiple set_customer_note
    - **Property 4: Last-writer-wins for multiple set_customer_note actions**
    - **Validates: Requirements 5.3**

  - [ ]* 5.6 Write property test: append_customer_note concatenation
    - **Property 5: append_customer_note concatenation**
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 5.7 Write property test: audit entries for customer note actions
    - **Property 7: Customer note actions produce audit entries with correct snapshots**
    - **Validates: Requirements 10.1, 10.2**

- [x] 6. QuoteEngine and RevisionEngine integration
  - [x] 6.1 Update QuoteEngine to persist `customerNote` from rules engine result
    - After `executeRules`, if `engineResult.customerNote !== null`, set `draft.customerNote = engineResult.customerNote`
    - _Requirements: 7.3, 7.4_

  - [x] 6.2 Update RevisionEngine to persist `customerNote` from rules engine result
    - After `executeRules`, if `engineResult.customerNote !== null`, include customerNote in revision output for persistence via `QuoteDraftService.update()`
    - _Requirements: 7.3_

- [x] 7. JobberQuotePushService — message field construction
  - [x] 7.1 Update `buildQuoteCreateInput` to include `customerNote` in the `message` field
    - If both customerNote and unresolved items present: `customerNote + "\n\n" + unresolvedText`
    - If only customerNote: just customerNote
    - If only unresolved items: just unresolvedText
    - If neither: omit message field
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 7.2 Write property test: message field construction
    - **Property 6: Message field construction for Jobber push**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Client UI — Note to Customer section
  - [x] 9.1 Add "Note to Customer" textarea to `QuoteDraftPage.tsx`
    - Position between line items table and "Push to Jobber" button
    - Multi-line textarea with placeholder text
    - Track local state for the textarea value
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 9.2 Implement save-on-blur behavior
    - On blur, compare trimmed value to last saved value
    - If changed, call `updateDraft` with `{ customerNote: trimmedValue }`
    - Show error toast on failure
    - _Requirements: 4.3_

  - [x] 9.3 Handle finalized draft state
    - When `draft.status === 'finalized'`, render textarea as read-only/disabled
    - _Requirements: 4.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties defined in the design document
- The implementation language is TypeScript throughout (client TSX, worker TS, shared TS)
- Property tests use `fast-check` with minimum 100 iterations per property in `tests/property/quote-customer-note.property.test.ts`
