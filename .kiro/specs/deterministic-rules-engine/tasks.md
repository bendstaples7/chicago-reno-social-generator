# Implementation Plan: Deterministic Rules Engine

## Overview

This plan implements a deterministic rules engine that programmatically enforces business rules after AI generates initial line items. The engine is a pure TypeScript module that evaluates structured conditions, executes typed actions, iterates until convergence, and produces a full audit trail. It integrates into the existing QuoteEngine and RevisionEngine pipelines as a post-processing step, while preserving backward compatibility with legacy prompt-only rules.

## Tasks

- [x] 1. Add shared types for the rules engine
  - [x] 1.1 Add structured rule types to `shared/src/types/quote.ts`
    - Add `TriggerMode`, `RuleConditionType`, `RuleCondition`, `RuleActionType`, `RuleAction`, `StructuredRule`, `AuditEntry`, `EngineLineItem`, and `RulesEngineResult` types as defined in the design document
    - Extend the existing `Rule` interface with optional `conditionJson`, `actionJson`, and `triggerMode` fields
    - Export all new types from `shared/src/types/index.ts`
    - _Requirements: 1.1, 1.2, 1.4, 8.4, 9.2_

  - [ ]* 1.2 Write unit tests for shared type exports
    - Verify all new types are importable from the shared package
    - _Requirements: 8.4, 9.2_

- [x] 2. Create the database migration for structured rules
  - [x] 2.1 Create migration `worker/src/migrations/0016_structured_rules.sql`
    - Add `condition_json TEXT DEFAULT NULL` column to the `rules` table
    - Add `action_json TEXT DEFAULT NULL` column to the `rules` table
    - Add `trigger_mode TEXT NOT NULL DEFAULT 'chained'` column to the `rules` table
    - _Requirements: 5.1, 5.2_

- [x] 3. Implement the core rules engine module
  - [x] 3.1 Create `worker/src/services/rules-engine.ts` with the `executeRules` function
    - Implement the main `executeRules(input: RulesEngineInput): RulesEngineResult` function
    - Clone input line items to avoid mutation
    - Implement the iterative convergence loop: evaluate rules in priority order, apply matching actions, re-iterate until no modifications or max iterations reached
    - Filter eligible rules by trigger mode per iteration (iteration 1: all rules; iteration 2+: only `chained` rules)
    - Track which rules have been applied to which line items to prevent duplicate applications within a single execution run
    - Default `maxIterations` to 10
    - Record a warning audit entry when max iterations reached without convergence
    - Return unmodified line items and empty audit trail when no rules fire
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 4.3, 4.4, 7.5, 9.1_

  - [x] 3.2 Implement the condition evaluator inside `rules-engine.ts`
    - Implement `evaluateCondition(condition, lineItems)` returning `{ matched, matchingLineItemIds }`
    - Support `line_item_exists`: case-insensitive exact match of `productName` against `productNamePattern`
    - Support `line_item_not_exists`: no line item matches the pattern (case-insensitive)
    - Support `line_item_quantity_gte`: matching line item has `quantity >= threshold`
    - Support `line_item_quantity_lte`: matching line item has `quantity <= threshold`
    - Support `always`: unconditionally returns `matched: true`
    - _Requirements: 1.2, 1.3_

  - [x] 3.3 Implement the action executor inside `rules-engine.ts`
    - Implement `executeAction(action, lineItems, catalog, ruleId)` returning `{ modified, lineItems, warning?, beforeSnapshot?, afterSnapshot? }`
    - Support `add_line_item`: look up product in catalog (case-insensitive), add new line item with catalog ID, skip with warning if not found
    - Support `remove_line_item`: remove all line items matching the product name pattern (case-insensitive)
    - Support `set_quantity`: set quantity on all matching line items
    - Support `adjust_quantity`: add delta to quantity on all matching line items, clamp to minimum 0
    - Support `set_unit_price`: set unit price on all matching line items
    - Append the rule's ID to `ruleIdsApplied` on all modified/added line items
    - _Requirements: 1.4, 1.5, 1.6, 7.3, 7.4_

  - [x] 3.4 Implement schema validation functions in `rules-engine.ts`
    - Export `validateCondition(condition: unknown): { valid: boolean; error?: string }`
    - Export `validateAction(action: unknown): { valid: boolean; error?: string }`
    - Export `validateActions(actions: unknown): { valid: boolean; errors?: string[] }`
    - Validate known `type` field, required fields per type, correct field types
    - Skip rules with invalid condition/action JSON at runtime, recording a warning audit entry
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 3.5 Write unit tests for the rules engine core
    - Test `executeRules` convergence loop with single and multiple iterations
    - Test trigger mode filtering (on_create vs chained across iterations)
    - Test duplicate application prevention (same rule to same line item)
    - Test max iteration cap with warning audit entry
    - Test empty rules list returns unmodified line items
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 4.3, 4.4_

  - [ ]* 3.6 Write unit tests for the condition evaluator
    - Test each condition type: `line_item_exists`, `line_item_not_exists`, `line_item_quantity_gte`, `line_item_quantity_lte`, `always`
    - Test case-insensitive matching for product name patterns
    - Test with empty line item arrays
    - _Requirements: 1.2, 1.3_

  - [ ]* 3.7 Write unit tests for the action executor
    - Test each action type: `add_line_item`, `remove_line_item`, `set_quantity`, `adjust_quantity`, `set_unit_price`
    - Test `add_line_item` with product found in catalog and product not found (warning)
    - Test `adjust_quantity` clamping to minimum 0
    - Test `ruleIdsApplied` is appended on modified/added line items
    - _Requirements: 1.4, 1.5, 1.6, 7.3, 7.4_

  - [ ]* 3.8 Write unit tests for schema validation
    - Test valid and invalid conditions for each condition type
    - Test valid and invalid actions for each action type
    - Test unknown types are rejected
    - Test missing required fields are rejected
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement audit trail generation
  - [x] 5.1 Ensure `executeRules` produces complete audit entries
    - Each audit entry must contain: rule ID, rule name, iteration number, condition, action, matching line item IDs, before/after snapshots of affected line items
    - Return the complete ordered list of audit entries alongside the final line items
    - Include iteration count and convergence flag in the result
    - _Requirements: 4.1, 4.2, 4.3, 9.1_

  - [ ]* 5.2 Write unit tests for audit trail generation
    - Test audit entries are created for each rule application with correct fields
    - Test audit trail ordering matches execution order
    - Test before/after snapshots capture correct state
    - Test warning entries for skipped actions (e.g., product not in catalog)
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Extend RulesService for structured rules
  - [x] 6.1 Update `RulesService.createRule()` to accept structured rule fields
    - Accept optional `conditionJson`, `actionJson`, `triggerMode` parameters
    - Validate condition and action schemas using `validateCondition` and `validateActions` before persisting
    - Return descriptive validation errors for invalid schemas
    - Persist `condition_json`, `action_json`, `trigger_mode` columns in the database
    - _Requirements: 5.1, 6.1, 6.2, 6.4_

  - [x] 6.2 Update `RulesService.updateRule()` to handle structured rule fields
    - Accept optional `conditionJson`, `actionJson`, `triggerMode` for updates
    - Re-validate schemas before persisting changes
    - _Requirements: 6.3, 6.4_

  - [x] 6.3 Add `RulesService.getActiveStructuredRules()` method
    - Query active rules that have non-null `condition_json` and `action_json`
    - Parse JSON columns into typed `StructuredRule[]` objects
    - Skip rules with invalid JSON (log warning, don't throw)
    - _Requirements: 5.3, 7.1_

  - [x] 6.4 Update `RulesService` row mapping to include new columns
    - Update `mapRuleRow()` to read `condition_json`, `action_json`, `trigger_mode` from DB rows
    - Map to the extended `Rule` interface with `conditionJson`, `actionJson`, `triggerMode` fields
    - Handle NULL values for legacy rules gracefully
    - _Requirements: 5.3, 5.4_

  - [ ]* 6.5 Write unit tests for RulesService structured rule extensions
    - Test creating a rule with valid condition/action JSON
    - Test creating a rule with invalid condition/action JSON returns validation error
    - Test updating a rule's condition/action JSON with re-validation
    - Test `getActiveStructuredRules()` returns only rules with valid structured data
    - Test legacy rules (null condition/action) are excluded from structured rules query
    - _Requirements: 5.1, 5.3, 6.1, 6.2, 6.3_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integrate rules engine into QuoteEngine
  - [x] 8.1 Modify `QuoteEngine.generateQuote()` to invoke the rules engine
    - After `validateAIResponse()`, before `deduplicateLineItems()`, call `executeRules()` with the validated AI line items, structured rules, and catalog
    - Fetch structured rules via `RulesService.getActiveStructuredRules()` (passed in or fetched)
    - Separate legacy rules (no condition/action JSON) from structured rules
    - Continue passing legacy rules to `buildRulesSection()` for AI prompt injection
    - Use the engine's output line items for deduplication and draft construction
    - _Requirements: 2.1, 7.1, 7.2_

  - [x] 8.2 Attach audit trail to the QuoteEngine output
    - Include the rules engine audit trail in the `QuoteEngineOutput` so the client can display rule traceability
    - _Requirements: 9.3_

  - [ ]* 8.3 Write unit tests for QuoteEngine rules engine integration
    - Test that structured rules are applied after AI response parsing
    - Test that legacy rules are still passed to the AI prompt
    - Test that audit trail is included in the output
    - _Requirements: 2.1, 7.1, 7.2, 9.3_

- [x] 9. Integrate rules engine into RevisionEngine
  - [x] 9.1 Modify `RevisionEngine.revise()` to invoke the rules engine
    - After `parseAndValidate()` produces AI line items, before `deduplicateLineItems()`, call `executeRules()` with the AI line items, structured rules, and catalog
    - Same pattern as QuoteEngine: separate legacy vs structured rules, pass legacy to prompt, run structured through engine
    - Use the engine's output line items for deduplication and result construction
    - _Requirements: 2.2, 7.1, 7.2_

  - [x] 9.2 Attach audit trail to the RevisionEngine output
    - Include the rules engine audit trail in the `RevisionOutput` so the caller can access rule traceability
    - _Requirements: 9.3_

  - [ ]* 9.3 Write unit tests for RevisionEngine rules engine integration
    - Test that structured rules are applied after AI response parsing
    - Test that legacy rules are still passed to the AI prompt
    - Test that audit trail is included in the output
    - _Requirements: 2.2, 7.1, 7.2, 9.3_

- [x] 10. Export rules engine from services barrel and update routes
  - [x] 10.1 Export `executeRules`, validation functions, and types from `worker/src/services/index.ts`
    - Add exports for `executeRules`, `validateCondition`, `validateAction`, `validateActions` from `rules-engine.js`
    - _Requirements: 7.5_

  - [x] 10.2 Update rules CRUD routes in `worker/src/routes/quotes.ts`
    - Update `POST /rules` to accept and validate `conditionJson`, `actionJson`, `triggerMode` fields
    - Update `PUT /rules/:id` to accept and validate structured rule fields on update
    - Return validation errors with descriptive messages for invalid schemas
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 10.3 Write unit tests for updated rules CRUD routes
    - Test creating a structured rule via API with valid condition/action
    - Test creating a structured rule with invalid schema returns error
    - Test updating a structured rule's condition/action via API
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design has no Correctness Properties section, so property-based tests are not included — unit tests cover all testing needs
- The migration number is `0016` since migrations `0001`–`0015` already exist
- Legacy rules (no `condition_json`/`action_json`) continue to work as prompt-only rules — full backward compatibility is maintained
- The rules engine is a pure function module with no external dependencies, making it trivially testable
