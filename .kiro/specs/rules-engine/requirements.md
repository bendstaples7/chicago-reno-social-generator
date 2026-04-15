# Requirements Document

## Introduction

The Rules Engine feature adds a user-managed business rules system to the quote generation platform. Currently, quote generation logic is hardcoded in AI system prompts within `QuoteEngine` and `RevisionEngine`. This feature externalizes those rules into a persistent, user-editable data model so that business users can view, create, and manage rules that govern how quotes are generated. It also adds rule traceability on quote line items and a feedback-to-rule creation workflow during quote revision.

## Glossary

- **Rules_Engine**: The server-side service responsible for storing, retrieving, organizing, and applying business rules during quote generation and revision.
- **Rules_Page**: The client-side page where business users view, browse, and manage all rules organized by group.
- **Rule**: A single business directive that influences how the QuoteEngine or RevisionEngine produces quote line items. A Rule has a name, description, group, priority order, and active/inactive status.
- **Rule_Group**: A named category used to organize related rules (e.g., "Bathroom Renovation", "General Pricing", "Demo & Teardown").
- **Rule_Traceability_Panel**: A UI component on the QuoteDraftPage that displays which rules contributed to each quote line item.
- **Rule_Creation_Toggle**: A toggle control on the QuoteDraftPage revision feedback section that, when enabled, creates a new rule from the feedback text in addition to revising the current quote.
- **QuoteEngine**: The existing server-side service that generates quote drafts from customer request text, product catalog, and AI.
- **RevisionEngine**: The existing server-side service that applies user feedback as delta operations on quote line items.
- **QuoteDraftPage**: The existing client-side page for viewing and revising a single quote draft.
- **Line_Item**: A single product/service entry on a quote, represented by the `QuoteLineItem` type.

## Requirements

### Requirement 1: Rule Data Model

**User Story:** As a business user, I want rules to be stored as structured data with a name, description, group, and priority, so that the system can organize and apply them consistently.

#### Acceptance Criteria

1. THE Rules_Engine SHALL store each Rule with the following fields: unique identifier, name, description, Rule_Group identifier, priority order within the group, active status, creation timestamp, and last-updated timestamp.
2. THE Rules_Engine SHALL store each Rule_Group with the following fields: unique identifier, name, description, display order, and creation timestamp.
3. WHEN a Rule is created without an explicit Rule_Group, THE Rules_Engine SHALL assign the Rule to a default "General" Rule_Group.
4. THE Rules_Engine SHALL enforce unique Rule names within the same Rule_Group.
5. IF a Rule creation request contains a duplicate name within the same Rule_Group, THEN THE Rules_Engine SHALL return a descriptive error indicating the name conflict.

### Requirement 2: Rules Management API

**User Story:** As a business user, I want to create, update, reorder, and deactivate rules through the application, so that I can maintain the rule set over time.

#### Acceptance Criteria

1. WHEN a valid create-rule request is received, THE Rules_Engine SHALL persist the new Rule and return the created Rule with its assigned identifier.
2. WHEN a valid update-rule request is received, THE Rules_Engine SHALL update the specified Rule fields and set the last-updated timestamp.
3. WHEN a deactivate-rule request is received, THE Rules_Engine SHALL set the Rule active status to false without deleting the Rule record.
4. WHEN a reorder request is received for rules within a Rule_Group, THE Rules_Engine SHALL update the priority order of all affected rules in that group.
5. WHEN a create-group request is received, THE Rules_Engine SHALL persist the new Rule_Group and return it with its assigned identifier.
6. WHEN a delete-group request is received for a Rule_Group that contains rules, THE Rules_Engine SHALL reassign those rules to the default "General" Rule_Group before deleting the group.
7. IF a create-rule request is missing the name or description field, THEN THE Rules_Engine SHALL return a validation error specifying the missing fields.

### Requirement 3: Rules Page Display

**User Story:** As a business user, I want a dedicated page to view all rules organized by group, so that I can understand and manage the full set of business rules at a glance.

#### Acceptance Criteria

1. THE Rules_Page SHALL display all Rule_Groups in their configured display order.
2. THE Rules_Page SHALL display all rules within each Rule_Group in their configured priority order.
3. THE Rules_Page SHALL visually distinguish active rules from inactive rules.
4. WHEN a Rule_Group contains zero rules, THE Rules_Page SHALL display the group with an empty-state message indicating no rules exist in that group.
5. THE Rules_Page SHALL be accessible at the route `/quotes/rules` within the existing client routing structure.
6. WHEN the Rules_Page loads, THE Rules_Page SHALL fetch all rules and groups from the Rules_Engine API in a single request.

### Requirement 4: Rule Creation and Editing on Rules Page

**User Story:** As a business user, I want to create and edit rules directly from the Rules Page, so that I can manage rules without leaving the page.

#### Acceptance Criteria

1. WHEN the user activates the "Add Rule" action on the Rules_Page, THE Rules_Page SHALL display a form with fields for rule name, description, Rule_Group selection, and active status.
2. WHEN the user submits a valid rule creation form, THE Rules_Page SHALL send a create-rule request to the Rules_Engine and display the new rule in the appropriate group without a full page reload.
3. WHEN the user activates the edit action on an existing rule, THE Rules_Page SHALL display a pre-populated form with the current rule fields.
4. WHEN the user submits a valid rule edit form, THE Rules_Page SHALL send an update-rule request to the Rules_Engine and reflect the changes in the rule list without a full page reload.
5. IF the Rules_Engine returns a validation error during rule creation or editing, THEN THE Rules_Page SHALL display the error message adjacent to the form.

### Requirement 5: Rule Application During Quote Generation

**User Story:** As a business user, I want active rules to be included in the AI prompt when generating quotes, so that the AI follows the business rules I have defined.

#### Acceptance Criteria

1. WHEN the QuoteEngine generates a new quote, THE QuoteEngine SHALL fetch all active rules from the Rules_Engine ordered by Rule_Group display order and rule priority order.
2. THE QuoteEngine SHALL include the fetched active rules in the AI system prompt as a structured "BUSINESS RULES" section, with each rule grouped under its Rule_Group name.
3. WHEN no active rules exist, THE QuoteEngine SHALL generate the quote using only the existing hardcoded prompt rules.
4. THE QuoteEngine SHALL instruct the AI to return a `ruleIdsApplied` array for each line item, containing the identifiers of rules that influenced that line item.
5. WHEN the AI response includes `ruleIdsApplied` for a line item, THE QuoteEngine SHALL persist those rule identifiers on the corresponding QuoteLineItem.

### Requirement 6: Rule Application During Quote Revision

**User Story:** As a business user, I want active rules to also be considered during quote revisions, so that revised quotes remain consistent with business rules.

#### Acceptance Criteria

1. WHEN the RevisionEngine processes a revision, THE RevisionEngine SHALL fetch all active rules from the Rules_Engine and include them in the AI system prompt.
2. THE RevisionEngine SHALL instruct the AI to return `ruleIdsApplied` for each line item in the revision response.
3. WHEN the AI response includes `ruleIdsApplied` for a revised line item, THE RevisionEngine SHALL persist those rule identifiers on the corresponding QuoteLineItem.

### Requirement 7: Rule Traceability on Quote Draft Page

**User Story:** As a business user, I want to see which rules caused each line item to appear on a quote, so that I can understand and verify the AI reasoning.

#### Acceptance Criteria

1. THE QuoteDraftPage SHALL display an info icon next to each Line_Item in the matched line items table.
2. WHEN the user activates the info icon for a Line_Item, THE Rule_Traceability_Panel SHALL expand to show the names and descriptions of all rules that were applied to that Line_Item.
3. WHEN a Line_Item has no associated rules, THE Rule_Traceability_Panel SHALL display a message indicating no specific rules were applied.
4. WHEN the Rule_Traceability_Panel is expanded, THE Rule_Traceability_Panel SHALL allow the user to collapse it by activating the info icon again.
5. THE Rule_Traceability_Panel SHALL group displayed rules by their Rule_Group name.

### Requirement 8: Rule Creation from Revision Feedback

**User Story:** As a business user, I want to optionally create a new rule from my revision feedback, so that the same correction applies to all future quotes automatically.

#### Acceptance Criteria

1. THE QuoteDraftPage SHALL display a Rule_Creation_Toggle adjacent to the revision feedback text area.
2. THE Rule_Creation_Toggle SHALL default to the OFF position each time the QuoteDraftPage loads.
3. WHEN the Rule_Creation_Toggle is ON and the user submits revision feedback, THE QuoteDraftPage SHALL send both a revision request and a rule creation request to the server.
4. WHEN the server receives a revision request with the rule creation flag enabled, THE Rules_Engine SHALL create a new Rule with the feedback text as the rule description and an auto-generated name derived from the feedback text.
5. WHEN the server receives a revision request with the rule creation flag enabled, THE RevisionEngine SHALL apply the feedback to the current quote draft as a revision.
6. WHEN rule creation from feedback succeeds, THE QuoteDraftPage SHALL display a confirmation message indicating the new rule was created and will apply to future quotes.
7. IF rule creation from feedback fails but the revision succeeds, THEN THE QuoteDraftPage SHALL display the revised quote and a warning that rule creation failed.
8. WHEN a rule is created from feedback, THE Rules_Engine SHALL assign the rule to a Rule_Group that best matches the quote context, defaulting to the "General" Rule_Group when no match is determined.

### Requirement 9: Database Schema for Rules

**User Story:** As a developer, I want a database migration that creates the rules tables, so that rule data is persisted reliably.

#### Acceptance Criteria

1. THE Rules_Engine SHALL use a new SQL migration numbered `013_rules_engine.sql` to create the `rule_groups` and `rules` tables.
2. THE migration SHALL create a `rule_groups` table with columns for id (UUID primary key), name (text, not null), description (text), display_order (integer, not null), and created_at (timestamp with default).
3. THE migration SHALL create a `rules` table with columns for id (UUID primary key), name (text, not null), description (text, not null), rule_group_id (UUID foreign key to rule_groups), priority_order (integer, not null), is_active (boolean, default true), created_at (timestamp with default), and updated_at (timestamp with default).
4. THE migration SHALL create a `line_item_rules` junction table with columns for line_item_id (text, not null), rule_id (UUID, foreign key to rules), and quote_draft_id (text, not null).
5. THE migration SHALL insert a default "General" Rule_Group record.
6. THE migration SHALL add a unique constraint on the combination of name and rule_group_id in the `rules` table.

### Requirement 10: Rules API Endpoints

**User Story:** As a developer, I want RESTful API endpoints for rules management, so that the client can interact with the rules system.

#### Acceptance Criteria

1. THE Rules_Engine SHALL expose a `GET /api/quotes/rules` endpoint that returns all Rule_Groups with their nested rules, ordered by display order and priority order.
2. THE Rules_Engine SHALL expose a `POST /api/quotes/rules` endpoint that creates a new Rule and returns the created Rule.
3. THE Rules_Engine SHALL expose a `PUT /api/quotes/rules/:id` endpoint that updates an existing Rule and returns the updated Rule.
4. THE Rules_Engine SHALL expose a `PUT /api/quotes/rules/:id/deactivate` endpoint that sets a Rule to inactive.
5. THE Rules_Engine SHALL expose a `POST /api/quotes/rules/groups` endpoint that creates a new Rule_Group.
6. THE Rules_Engine SHALL expose a `PUT /api/quotes/rules/groups/:id` endpoint that updates an existing Rule_Group.
7. WHEN any rules endpoint is called without a valid session, THE Rules_Engine SHALL return a 401 unauthorized response.
