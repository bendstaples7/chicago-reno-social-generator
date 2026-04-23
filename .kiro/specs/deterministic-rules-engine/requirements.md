# Requirements Document

## Introduction

The current quote generation system relies on prompt-based business rules: free-text rule descriptions are concatenated into the AI system prompt, and the AI self-reports which rules it applied. This approach does not scale beyond a handful of rules — prompt stuffing degrades AI instruction-following, there is no guarantee rules are correctly evaluated, and there is no support for chaining or conditional logic.

This feature introduces a **deterministic rules engine** that executes structured, typed rules **after** the AI generates initial line items. The engine evaluates conditions against the current line item set, executes typed actions (add, remove, modify line items), iterates until convergence or a max-iteration cap, and produces a full audit trail of every rule application. This replaces the advisory prompt-based approach with programmatic enforcement while preserving the AI's role in initial line item generation.

## Glossary

- **Rules_Engine**: The pure TypeScript module that evaluates structured rules against a set of quote line items, executing actions deterministically in priority order with iterative convergence.
- **Structured_Rule**: A rule with a typed condition, typed action, priority, and trigger mode — stored in the database and evaluated programmatically by the Rules_Engine.
- **Rule_Condition**: A typed, structured predicate that the Rules_Engine evaluates against the current line item set (e.g., "a line item with productName matching 'Cabinet Painting' exists").
- **Rule_Action**: A typed, structured operation the Rules_Engine performs when a Rule_Condition is satisfied (e.g., "add a line item", "modify quantity", "remove a line item").
- **Execution_Loop**: The iterative cycle where the Rules_Engine evaluates all active rules against the current line item set, applies matching actions, and re-evaluates until no more rules fire or the max-iteration cap is reached.
- **Audit_Entry**: A structured log record produced by the Rules_Engine for each rule application, capturing the rule ID, the condition that matched, the action taken, and the before/after state of affected line items.
- **Trigger_Mode**: Specifies when a Structured_Rule is eligible to fire — either on initial quote creation only, or as a chained rule that fires when its conditions are met during any iteration of the Execution_Loop.
- **Max_Iteration_Cap**: The upper bound on Execution_Loop iterations, preventing infinite loops from circular rule chains.
- **Product_Catalog**: The set of ProductCatalogEntry records used to validate product references in Rule_Actions.
- **Quote_Engine**: The existing AI-powered quote generation service that produces initial line items from customer requests.
- **Revision_Engine**: The existing AI-powered quote revision service that modifies line items based on user feedback.

## Requirements

### Requirement 1: Structured Rule Schema

**User Story:** As a business administrator, I want rules to have typed conditions and actions instead of free-text descriptions, so that the system can evaluate them programmatically with guaranteed correctness.

#### Acceptance Criteria

1. THE Structured_Rule SHALL have a unique identifier, a human-readable name, a priority order (integer), a Trigger_Mode, an active/inactive flag, a single Rule_Condition, and one or more Rule_Actions.
2. THE Rule_Condition SHALL support the following condition types: "line_item_exists" (a line item matching a product name pattern is present), "line_item_not_exists" (no line item matches a product name pattern), "line_item_quantity_gte" (a matching line item has quantity greater than or equal to a threshold), "line_item_quantity_lte" (a matching line item has quantity less than or equal to a threshold), and "always" (the condition is unconditionally true).
3. WHEN a Rule_Condition references a product name, THE Rules_Engine SHALL match using case-insensitive string comparison.
4. THE Rule_Action SHALL support the following action types: "add_line_item" (add a new line item with a specified product name, quantity, unit price, and description), "remove_line_item" (remove all line items matching a product name pattern), "set_quantity" (set the quantity of matching line items to a specified value), "adjust_quantity" (add or subtract a delta from the quantity of matching line items), and "set_unit_price" (set the unit price of matching line items to a specified value).
5. WHEN a Rule_Action of type "add_line_item" references a product name, THE Rules_Engine SHALL validate that the product name exists in the Product_Catalog and use the catalog entry's ID for the new line item.
6. IF a Rule_Action of type "add_line_item" references a product name that does not exist in the Product_Catalog, THEN THE Rules_Engine SHALL skip the action and record a warning in the Audit_Entry.

### Requirement 2: Post-AI Execution Loop

**User Story:** As a business administrator, I want the rules engine to run after the AI generates initial line items, so that business rules are enforced deterministically regardless of AI behavior.

#### Acceptance Criteria

1. WHEN the Quote_Engine produces an initial set of line items, THE Rules_Engine SHALL execute the Execution_Loop against those line items before the quote draft is returned to the caller.
2. WHEN the Revision_Engine produces a revised set of line items, THE Rules_Engine SHALL execute the Execution_Loop against those line items before the revision result is returned to the caller.
3. THE Execution_Loop SHALL evaluate all active Structured_Rules in ascending priority order during each iteration.
4. WHEN a Structured_Rule's Rule_Condition evaluates to true and the rule has not already been applied in the current iteration, THE Rules_Engine SHALL execute all of the rule's Rule_Actions against the current line item set.
5. WHEN at least one Rule_Action modifies the line item set during an iteration, THE Rules_Engine SHALL begin a new iteration to re-evaluate all eligible rules.
6. WHEN no Rule_Action modifies the line item set during an iteration, THE Rules_Engine SHALL terminate the Execution_Loop (convergence).
7. WHEN the Execution_Loop reaches the Max_Iteration_Cap, THE Rules_Engine SHALL terminate the loop and record a warning in the Audit_Entry indicating that convergence was not reached.
8. THE Max_Iteration_Cap SHALL default to 10 iterations.

### Requirement 3: Trigger Modes and Chaining

**User Story:** As a business administrator, I want some rules to fire only on initial quote creation and others to chain after other rules have fired, so that I can express dependent business logic.

#### Acceptance Criteria

1. THE Trigger_Mode SHALL support two values: "on_create" (the rule is eligible only during the first iteration of the Execution_Loop) and "chained" (the rule is eligible during any iteration of the Execution_Loop).
2. WHEN the Execution_Loop is on its first iteration, THE Rules_Engine SHALL evaluate both "on_create" and "chained" rules.
3. WHEN the Execution_Loop is on its second or subsequent iteration, THE Rules_Engine SHALL evaluate only "chained" rules.
4. THE Rules_Engine SHALL not re-apply a specific Structured_Rule to the same line item within a single Execution_Loop run to prevent duplicate applications.

### Requirement 4: Deterministic Audit Trail

**User Story:** As a business administrator, I want a complete log of every rule that fired, what it changed, and why, so that I can debug and verify quote generation behavior.

#### Acceptance Criteria

1. WHEN the Rules_Engine applies a Rule_Action, THE Rules_Engine SHALL create an Audit_Entry containing: the Structured_Rule ID, the Structured_Rule name, the iteration number, the Rule_Condition that matched, the Rule_Action that was executed, and the before/after snapshot of affected line items.
2. THE Rules_Engine SHALL return the complete ordered list of Audit_Entries alongside the final line item set after the Execution_Loop completes.
3. THE Rules_Engine SHALL include the total number of iterations executed and whether convergence was reached in the execution result.
4. WHEN no rules fire during the Execution_Loop, THE Rules_Engine SHALL return an empty audit trail and the unmodified line item set.

### Requirement 5: Rule Persistence and Migration

**User Story:** As a business administrator, I want structured rules stored in the database with their conditions and actions, so that rules survive deployments and can be managed through the existing UI.

#### Acceptance Criteria

1. THE Rules_Engine SHALL store Structured_Rule condition and action data as JSON columns in the existing `rules` database table via a D1 migration.
2. THE Rules_Engine SHALL add a `trigger_mode` column to the `rules` table with a default value of "chained".
3. WHEN a Structured_Rule has no condition or action JSON (legacy rule), THE Rules_Engine SHALL skip the rule during Execution_Loop evaluation and treat it as a prompt-only rule for backward compatibility.
4. THE Rules_Engine SHALL preserve the existing `rule_groups` organizational structure for Structured_Rules.

### Requirement 6: Rule CRUD API

**User Story:** As a business administrator, I want to create, read, update, and delete structured rules through the API, so that I can manage rules without direct database access.

#### Acceptance Criteria

1. WHEN a create-rule request includes condition and action JSON, THE Rules_Engine SHALL validate the condition and action schemas before persisting the rule.
2. IF a create-rule or update-rule request contains an invalid condition or action schema, THEN THE Rules_Engine SHALL return a descriptive validation error identifying the specific schema violation.
3. WHEN an update-rule request modifies condition or action JSON, THE Rules_Engine SHALL re-validate the schemas before persisting.
4. THE Rules_Engine SHALL support setting the Trigger_Mode when creating or updating a Structured_Rule.

### Requirement 7: Integration with Existing Quote Flow

**User Story:** As a developer, I want the rules engine to integrate cleanly with the existing QuoteEngine and RevisionEngine, so that the transition from prompt-based rules to deterministic rules is incremental and non-breaking.

#### Acceptance Criteria

1. THE Rules_Engine SHALL continue to pass prompt-only rules (legacy rules without structured conditions/actions) to the AI system prompt via the existing `buildRulesSection` function.
2. THE Rules_Engine SHALL execute structured rules in the Execution_Loop after the AI response is parsed and validated, but before deduplication.
3. WHEN the Rules_Engine adds a line item via a Rule_Action, THE Rules_Engine SHALL set the `ruleIdsApplied` field on that line item to include the Structured_Rule's ID.
4. WHEN the Rules_Engine modifies an existing line item via a Rule_Action, THE Rules_Engine SHALL append the Structured_Rule's ID to the line item's `ruleIdsApplied` array.
5. THE Rules_Engine SHALL be a pure TypeScript module with no external dependencies, instantiated with the current line item set and Product_Catalog.

### Requirement 8: Condition and Action Schema Validation

**User Story:** As a developer, I want rule conditions and actions validated at creation time and at runtime, so that malformed rules cannot corrupt quote generation.

#### Acceptance Criteria

1. THE Rules_Engine SHALL validate Rule_Condition JSON against a TypeScript type schema, rejecting unknown condition types and missing required fields.
2. THE Rules_Engine SHALL validate Rule_Action JSON against a TypeScript type schema, rejecting unknown action types and missing required fields.
3. WHEN a Structured_Rule's condition or action JSON fails runtime validation during the Execution_Loop, THE Rules_Engine SHALL skip the rule, record a warning in the Audit_Entry, and continue processing remaining rules.
4. THE Rules_Engine SHALL export the condition and action TypeScript types from the shared package so that both client and worker can reference them.

### Requirement 9: Rules Engine Execution Result Types

**User Story:** As a developer, I want typed execution results from the rules engine, so that the quote draft page can display rule application details to the user.

#### Acceptance Criteria

1. THE Rules_Engine SHALL return an execution result containing: the final line item array, the audit trail (ordered list of Audit_Entries), the total iteration count, and a convergence flag.
2. THE Rules_Engine execution result types SHALL be exported from the shared package.
3. WHEN the quote draft is returned to the client, THE Quote_Engine SHALL include the rules engine audit trail in the response so the client can display rule traceability.
