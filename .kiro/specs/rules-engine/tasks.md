# Implementation Plan: Rules Engine

## Overview

This plan implements the Rules Engine feature, which externalizes business rules from hardcoded AI prompts into a persistent, user-managed data model. The implementation proceeds bottom-up: database schema first, then shared types, server service and route layers, AI engine integration, and finally client UI. Each step builds on the previous one, and property-based tests validate correctness properties from the design document alongside implementation.

## Tasks

- [x] 1. Create database migration and shared types
  - [x] 1.1 Create `server/src/migrations/013_rules_engine.sql` migration
    - Create `rule_groups` table with columns: id (UUID PK, default gen_random_uuid()), name (text not null), description (text), display_order (integer not null default 0), created_at (timestamp not null default NOW())
    - Create `rules` table with columns: id (UUID PK, default gen_random_uuid()), name (text not null), description (text not null), rule_group_id (UUID FK to rule_groups), priority_order (integer not null default 0), is_active (boolean not null default true), created_at (timestamp not null default NOW()), updated_at (timestamp not null default NOW())
    - Add unique constraint on (name, rule_group_id) in rules table
    - Create `line_item_rules` junction table with columns: line_item_id (text not null), rule_id (UUID FK to rules), quote_draft_id (text not null), with primary key on (line_item_id, rule_id)
    - Add indexes on rules(rule_group_id), rules(is_active), line_item_rules(quote_draft_id), line_item_rules(rule_id)
    - Insert default "General" rule group record
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 1.2 Add Rule, RuleGroup, and RuleGroupWithRules types to `shared/src/types/quote.ts`
    - Add `Rule` interface with fields: id, name, description, ruleGroupId, priorityOrder, isActive, createdAt, updatedAt
    - Add `RuleGroup` interface with fields: id, name, description (string | null), displayOrder, createdAt
    - Add `RuleGroupWithRules` interface extending RuleGroup with a `rules: Rule[]` field
    - Add optional `ruleIdsApplied?: string[]` field to the existing `QuoteLineItem` interface
    - Verify types are automatically exported via the existing barrel in `shared/src/types/index.ts`
    - _Requirements: 1.1, 1.2, 5.5_

- [x] 2. Implement RulesService
  - [x] 2.1 Create `server/src/services/rules-service.ts` with CRUD operations
    - Implement `getAllGroupedRules()` — fetch all groups with nested rules, ordered by display_order and priority_order
    - Implement `getActiveRulesGrouped()` — same as above but filtered to is_active = true
    - Implement `createRule(data)` — validate name/description required, assign to "General" group if no groupId, enforce unique name within group, persist and return created rule
    - Implement `updateRule(ruleId, data)` — update specified fields, set updated_at, return updated rule
    - Implement `deactivateRule(ruleId)` — set is_active to false, return updated rule
    - Implement `reorderRules(ruleGroupId, ruleIds)` — update priority_order for all rules in the group to match the provided order
    - Implement `createGroup(data)` — persist new group, return it
    - Implement `updateGroup(groupId, data)` — update specified fields, return updated group
    - Implement `deleteGroup(groupId)` — prevent deletion of "General" group, reassign rules to "General" before deleting
    - Implement `getDefaultGroupId()` — fetch the "General" group ID
    - Use `query()` and `getClient()` from `server/src/config/database.ts`
    - Use `PlatformError` for all error cases (not found, duplicate name, missing fields, cannot delete default group)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 2.2 Add `createRuleFromFeedback` and line-item-rules methods to RulesService
    - Implement `createRuleFromFeedback(feedbackText, quoteContext?)` — auto-generate a rule name from the feedback text (truncated/summarized), use feedback as description, assign to "General" group by default
    - Implement `saveLineItemRules(quoteDraftId, lineItemRules)` — persist rule-to-line-item associations in the `line_item_rules` junction table
    - Implement `getLineItemRules(quoteDraftId)` — fetch all rule associations for a draft, return as Map<lineItemId, Rule[]>
    - _Requirements: 8.4, 8.8, 5.5, 6.3_

  - [x] 2.3 Export RulesService from `server/src/services/index.ts`
    - Add `export { RulesService } from './rules-service.js';` to the barrel file
    - _Requirements: 2.1_

  - [ ]* 2.4 Write property tests for RulesService CRUD (Properties 1–4)
    - **Property 1: Rule creation round-trip** — For any valid name/description, createRule then fetch returns matching fields, isActive defaults true, valid UUID, timestamps not in future
    - **Validates: Requirements 1.1, 2.1, 10.2**
    - **Property 2: Group creation round-trip** — For any valid group name/description, createGroup then fetch returns matching fields, valid UUID, creation timestamp
    - **Validates: Requirements 1.2, 2.5, 10.5**
    - **Property 3: Default group assignment** — For any rule created without explicit ruleGroupId, the rule's ruleGroupId equals the "General" group ID
    - **Validates: Requirements 1.3, 8.8**
    - **Property 4: Unique name enforcement within group** — After creating a rule with a name in a group, creating another with the same name in the same group fails with a validation error
    - **Validates: Requirements 1.4, 1.5**
    - Write in `tests/property/rules-engine.property.test.ts` using fast-check and vitest
    - Mock `query`/`getClient` following existing patterns in `tests/unit/helpers/`

  - [ ]* 2.5 Write property tests for RulesService mutations (Properties 5–9)
    - **Property 5: Rule update preserves changes and advances timestamp** — For any existing rule and valid partial update, returned rule reflects changed fields, preserves unchanged fields, updatedAt >= original
    - **Validates: Requirements 2.2, 10.3**
    - **Property 6: Deactivation preserves rule without deletion** — For any active rule, after deactivateRule, rule is still retrievable, isActive is false, other fields unchanged
    - **Validates: Requirements 2.3, 10.4**
    - **Property 7: Reorder updates priority to match requested order** — For any group with N rules and any permutation, after reorderRules, fetching rules by priorityOrder matches the permutation
    - **Validates: Requirements 2.4**
    - **Property 8: Group deletion reassigns all rules to General** — For any non-default group with rules, after deleteGroup, all rules belong to "General" group, total rule count unchanged
    - **Validates: Requirements 2.6**
    - **Property 9: Validation rejects missing required fields** — For any createRule request with empty/missing name or description, throws PlatformError mentioning the missing field(s)
    - **Validates: Requirements 2.7**
    - Append to `tests/property/rules-engine.property.test.ts`

  - [ ]* 2.6 Write property tests for ordering and group updates (Properties 13–14)
    - **Property 13: Rules ordering invariant** — For any set of groups with display orders and rules with priority orders, getAllGroupedRules returns groups sorted by displayOrder ascending, rules within each group sorted by priorityOrder ascending
    - **Validates: Requirements 10.1**
    - **Property 14: Group update preserves changes** — For any existing group and valid partial update, returned group reflects changed fields, preserves unchanged fields
    - **Validates: Requirements 10.6**
    - Append to `tests/property/rules-engine.property.test.ts`

  - [ ]* 2.7 Write unit tests for RulesService
    - Create `tests/unit/rules-service.test.ts`
    - Test CRUD happy paths with concrete inputs
    - Test edge cases: empty group name, very long rule descriptions, special characters in names
    - Test `createRuleFromFeedback` with various feedback lengths and formats
    - Test `getDefaultGroupId` returns the seeded "General" group
    - Test `deleteGroup` on the default "General" group throws PlatformError
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1–2.7, 8.4, 8.8_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Integrate rules into QuoteEngine and RevisionEngine
  - [x] 4.1 Modify `server/src/services/quote-engine.ts` to accept and inject rules
    - Add optional `rules?: RuleGroupWithRules[]` parameter to `generateQuote()` method signature
    - Add a `buildRulesSection(rules)` private method that formats rules as a "BUSINESS RULES" prompt section, grouped by group name with each rule's description listed under its group
    - Inject the rules section into the system prompt when rules are provided
    - Extend the AI response JSON schema to include `ruleIdsApplied: string[]` per line item
    - Parse `ruleIdsApplied` from the AI response and include it on each `QuoteLineItem` in the draft
    - When no rules are provided, generate the quote using only the existing hardcoded prompt
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 4.2 Modify `server/src/services/revision-engine.ts` to accept and inject rules
    - Add optional `rules?: RuleGroupWithRules[]` field to the `RevisionInput` interface
    - Reuse or replicate the `buildRulesSection()` logic to inject rules into the revision system prompt
    - Extend the AI response JSON schema to include `ruleIdsApplied: string[]` per line item
    - Parse `ruleIdsApplied` from the AI response and include it on each `QuoteLineItem`
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 4.3 Write property tests for prompt builder and AI response parsing (Properties 10–11)
    - **Property 10: Prompt builder includes all active rules grouped correctly** — For any non-empty list of RuleGroupWithRules, the prompt string contains a "BUSINESS RULES" section, each group name appears as a heading, and all rule descriptions are listed under their group
    - **Validates: Requirements 5.2**
    - **Property 11: AI response ruleIdsApplied round-trip** — For any AI response JSON with line items containing ruleIdsApplied arrays, parsing produces QuoteLineItem objects with the same ruleIdsApplied arrays
    - **Validates: Requirements 5.5, 6.3**
    - Append to `tests/property/rules-engine.property.test.ts`

  - [ ]* 4.4 Write property test for rule-from-feedback (Property 12)
    - **Property 12: Rule from feedback uses feedback as description** — For any non-empty feedback string, createRuleFromFeedback produces a rule whose description equals the feedback and whose name is a non-empty string derived from and no longer than the feedback text
    - **Validates: Requirements 8.4**
    - Append to `tests/property/rules-engine.property.test.ts`

- [x] 5. Extend QuoteDraftService and route layer for rules persistence
  - [x] 5.1 Modify `server/src/services/quote-draft-service.ts` to persist and fetch line_item_rules
    - In `save()`, after persisting line items, call `RulesService.saveLineItemRules()` for any line items that have `ruleIdsApplied`
    - In `getById()`, after fetching line items, call `RulesService.getLineItemRules()` and attach `ruleIdsApplied` to each line item
    - In `update()`, when replacing line items, clear existing `line_item_rules` for the draft and re-persist from the updated line items
    - _Requirements: 5.5, 6.3, 7.1_

  - [x] 5.2 Add rules CRUD endpoints to `server/src/routes/quotes.ts`
    - Add `GET /rules` — calls `RulesService.getAllGroupedRules()`, returns grouped rules
    - Add `POST /rules` — validates body, calls `RulesService.createRule()`, returns created rule
    - Add `PUT /rules/:id` — calls `RulesService.updateRule()`, returns updated rule
    - Add `PUT /rules/:id/deactivate` — calls `RulesService.deactivateRule()`, returns updated rule
    - Add `POST /rules/groups` — calls `RulesService.createGroup()`, returns created group
    - Add `PUT /rules/groups/:id` — calls `RulesService.updateGroup()`, returns updated group
    - Add `DELETE /rules/groups/:id` — calls `RulesService.deleteGroup()`, returns success
    - Instantiate `RulesService` at the top of the routes file alongside other services
    - All endpoints are protected by the existing `sessionMiddleware`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 5.3 Modify generate and revise routes to integrate rules
    - In `POST /generate` route handler, call `rulesService.getActiveRulesGrouped()` and pass the result to `quoteEngine.generateQuote()` as the new `rules` parameter
    - In `POST /drafts/:id/revise` route handler, call `rulesService.getActiveRulesGrouped()` and pass rules to `revisionEngine.revise()` via the `RevisionInput`
    - In the revise route, accept optional `createRule` boolean from request body; when true, call `rulesService.createRuleFromFeedback(feedbackText)` after the revision succeeds
    - Return `ruleCreated` field in the revise response when a rule was created, or `ruleCreationError` if rule creation failed but revision succeeded
    - After revision, call `rulesService.saveLineItemRules()` to persist rule associations from the revised line items
    - _Requirements: 5.1, 5.4, 5.5, 6.1, 6.2, 6.3, 8.3, 8.4, 8.5, 8.7_

- [x] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement client API functions and RulesPage
  - [x] 7.1 Add rules API functions to `client/src/api.ts`
    - Add `fetchRules()` — GET `/api/quotes/rules`, returns `RuleGroupWithRules[]`
    - Add `createRule(data)` — POST `/api/quotes/rules`, returns `Rule`
    - Add `updateRule(id, data)` — PUT `/api/quotes/rules/:id`, returns `Rule`
    - Add `deactivateRule(id)` — PUT `/api/quotes/rules/:id/deactivate`, returns `Rule`
    - Add `createRuleGroup(data)` — POST `/api/quotes/rules/groups`, returns `RuleGroup`
    - Add `updateRuleGroup(id, data)` — PUT `/api/quotes/rules/groups/:id`, returns `RuleGroup`
    - Add `deleteRuleGroup(id)` — DELETE `/api/quotes/rules/groups/:id`
    - Modify existing `reviseDraft()` to accept optional `createRule?: boolean` parameter and include it in the request body; update return type to include optional `ruleCreated` field
    - Import new types (`Rule`, `RuleGroup`, `RuleGroupWithRules`) from `shared`
    - _Requirements: 3.6, 4.2, 4.4, 8.3_

  - [x] 7.2 Create `client/src/pages/RulesPage.tsx`
    - Fetch all groups+rules on mount via `fetchRules()`
    - Display groups in display order, rules within each group in priority order
    - Visually distinguish active rules from inactive rules (opacity + badge)
    - Show empty-state message for groups with zero rules
    - Add "Add Rule" button that shows an inline form with fields: name, description, group selection, active status
    - Add edit action on each rule that shows a pre-populated inline form
    - On form submit, call `createRule()` or `updateRule()` and update the list without full page reload
    - Display validation errors from the API adjacent to the form
    - Use inline styles (React.CSSProperties) consistent with the rest of the app
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 7.3 Add `/quotes/rules` route to `client/src/App.tsx`
    - Import `RulesPage` component
    - Add `<Route path="/quotes/rules" element={<RulesPage />} />` inside the protected Layout routes, alongside existing quote routes
    - _Requirements: 3.5_

- [x] 8. Add rule traceability and rule-creation toggle to QuoteDraftPage
  - [x] 8.1 Add Rule Traceability Panel to `client/src/pages/QuoteDraftPage.tsx`
    - Add an info icon (ℹ) next to each line item in the matched line items table
    - On click, toggle an expandable panel below the row showing applied rules grouped by group name, with rule name and description
    - When a line item has no associated rules (empty or missing `ruleIdsApplied`), show "No specific rules were applied"
    - Fetch rule details for the draft's line items — use the `ruleIdsApplied` field on each `QuoteLineItem` and the rules data from `fetchRules()`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 8.2 Add Rule Creation Toggle to `client/src/pages/QuoteDraftPage.tsx`
    - Add a toggle switch adjacent to the feedback textarea, labeled "Also save as rule for future quotes"
    - Default the toggle to OFF on page load
    - When toggle is ON and user submits feedback, pass `createRule: true` to the `reviseDraft()` API call
    - On success with `ruleCreated` in response, display a confirmation message indicating the new rule was created
    - If revision succeeds but `ruleCreationError` is present, display a warning that rule creation failed while showing the revised quote
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

- [x] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 14 correctness properties defined in the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout, matching the existing codebase
