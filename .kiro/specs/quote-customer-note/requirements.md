# Requirements Document

## Introduction

This feature adds a "note to customer" field to the app's quote system. Jobber quotes have a `message` field that appears as a customer-facing note on published quotes. The app currently does not expose this field — the push service only populates it with unresolved items text. This feature introduces a `customerNote` field on the quote draft data model, integrates it with the deterministic rules engine so rules can auto-fill the note based on conditions, provides UI support for viewing and editing the note, and ensures the note is correctly published to Jobber via the `quoteCreate` GraphQL mutation.

## Glossary

- **Quote_Draft**: An AI-generated quote with line items, stored in the `quote_drafts` D1 table, that can be edited and eventually pushed to Jobber.
- **Customer_Note**: A free-text message attached to a Quote_Draft that is visible to the customer when the quote is published in Jobber. Maps to the `message` field in Jobber's `quoteCreate` mutation.
- **Rules_Engine**: The deterministic rules engine (`RulesEngine`) that evaluates structured conditions against line items and executes typed actions after AI quote generation.
- **QuoteDraftPage**: The React page component (`client/src/pages/QuoteDraftPage.tsx`) where users view and edit a single quote draft.
- **JobberQuotePushService**: The worker service (`worker/src/services/jobber-quote-push-service.ts`) that pushes a finalized quote draft to Jobber via the `quoteCreate` GraphQL mutation.
- **QuoteDraftService**: The worker service (`worker/src/services/quote-draft-service.ts`) that persists and retrieves quote drafts from D1.
- **RuleAction**: A typed action object executed by the Rules_Engine when a rule's condition matches.

## Requirements

### Requirement 1: Customer Note Data Model

**User Story:** As a user, I want quote drafts to have a customer note field, so that I can include a message for the customer on the published quote.

#### Acceptance Criteria

1. THE Quote_Draft SHALL include a `customerNote` field of type `string` or `null`.
2. WHEN a new Quote_Draft is created, THE QuoteDraftService SHALL default the `customerNote` field to `null`.
3. THE QuoteDraftService SHALL persist the `customerNote` field to the `quote_drafts` D1 table in a `customer_note` column.
4. WHEN a Quote_Draft is retrieved by the QuoteDraftService, THE QuoteDraftService SHALL include the persisted `customerNote` value in the returned object.

### Requirement 2: Customer Note Database Migration

**User Story:** As a developer, I want the database schema to support the customer note field, so that the data is persisted correctly.

#### Acceptance Criteria

1. THE migration SHALL add a `customer_note` column of type `TEXT` with a default value of `NULL` to the `quote_drafts` table.
2. WHEN the migration is applied, THE migration SHALL preserve all existing Quote_Draft rows without modification.

### Requirement 3: Customer Note API Support

**User Story:** As a user, I want to update the customer note through the API, so that I can set or change the note before publishing.

#### Acceptance Criteria

1. WHEN a `PUT /api/quotes/drafts/:id` request includes a `customerNote` field, THE API SHALL persist the provided value to the Quote_Draft.
2. WHEN a `PUT /api/quotes/drafts/:id` request omits the `customerNote` field, THE API SHALL leave the existing `customerNote` value unchanged.
3. WHEN a `GET /api/quotes/drafts/:id` response is returned, THE API SHALL include the `customerNote` field in the response body.
4. WHEN a `GET /api/quotes/drafts` response is returned, THE API SHALL include the `customerNote` field on each Quote_Draft in the response body.

### Requirement 4: Customer Note UI Display and Editing

**User Story:** As a user, I want to see and edit the customer note on the quote draft page, so that I can review and modify the note before publishing.

#### Acceptance Criteria

1. THE QuoteDraftPage SHALL display a "Note to Customer" section with a multi-line text area showing the current `customerNote` value.
2. WHEN the `customerNote` is `null` or empty, THE QuoteDraftPage SHALL display placeholder text indicating the field is optional.
3. WHEN the user edits the text area and removes focus (blur), THE QuoteDraftPage SHALL save the updated `customerNote` value via the `PUT /api/quotes/drafts/:id` endpoint.
4. WHEN the Quote_Draft status is `finalized`, THE QuoteDraftPage SHALL display the `customerNote` as read-only text.
5. THE "Note to Customer" section SHALL be positioned above the "Push to Jobber" button and below the line items table.

### Requirement 5: Rules Engine — Set Customer Note Action

**User Story:** As a user, I want rules to automatically set the customer note based on conditions, so that standard notes are applied consistently without manual entry.

#### Acceptance Criteria

1. THE Rules_Engine SHALL support a `set_customer_note` RuleAction type with a required `text` field of type `string`.
2. WHEN a rule with a `set_customer_note` action fires, THE Rules_Engine SHALL set the Customer_Note to the value of the `text` field.
3. IF multiple rules with `set_customer_note` actions fire during the same execution, THEN THE Rules_Engine SHALL use the value from the last rule to fire (highest priority order that matched).
4. THE Rules_Engine schema validator SHALL validate that `set_customer_note` actions have a non-empty string `text` field.

### Requirement 6: Rules Engine — Append Customer Note Action

**User Story:** As a user, I want rules to append text to the customer note, so that multiple rules can each contribute a relevant note segment.

#### Acceptance Criteria

1. THE Rules_Engine SHALL support an `append_customer_note` RuleAction type with a required `text` field of type `string` and an optional `separator` field of type `string` defaulting to a newline character.
2. WHEN a rule with an `append_customer_note` action fires and the current Customer_Note is empty or null, THE Rules_Engine SHALL set the Customer_Note to the value of the `text` field.
3. WHEN a rule with an `append_customer_note` action fires and the current Customer_Note already contains text, THE Rules_Engine SHALL append the `separator` followed by the `text` value to the existing Customer_Note.
4. THE Rules_Engine schema validator SHALL validate that `append_customer_note` actions have a non-empty string `text` field.

### Requirement 7: Rules Engine Result — Customer Note Output

**User Story:** As a developer, I want the rules engine result to include the computed customer note, so that the quote generation pipeline can persist it on the draft.

#### Acceptance Criteria

1. THE RulesEngineResult SHALL include a `customerNote` field of type `string` or `null`.
2. WHEN no `set_customer_note` or `append_customer_note` actions fire during execution, THE RulesEngineResult SHALL return `customerNote` as `null`.
3. WHEN the Rules_Engine produces a non-null `customerNote`, THE QuoteEngine and RevisionEngine SHALL persist the `customerNote` value on the Quote_Draft.
4. WHEN the Rules_Engine produces a non-null `customerNote` and the Quote_Draft already has a `customerNote` value, THE QuoteEngine SHALL overwrite the existing value with the Rules_Engine output.

### Requirement 8: Jobber Publishing — Include Customer Note

**User Story:** As a user, I want the customer note to appear on the Jobber quote when I push it, so that my customer sees the note.

#### Acceptance Criteria

1. WHEN a Quote_Draft with a non-empty `customerNote` is pushed to Jobber, THE JobberQuotePushService SHALL include the `customerNote` value in the `message` field of the `quoteCreate` mutation attributes.
2. WHEN a Quote_Draft has both a non-empty `customerNote` and unresolved items, THE JobberQuotePushService SHALL combine the `customerNote` and the unresolved items text into the `message` field, with the `customerNote` appearing first, separated by two newline characters.
3. WHEN a Quote_Draft has a `null` or empty `customerNote` and has unresolved items, THE JobberQuotePushService SHALL include only the unresolved items text in the `message` field.
4. WHEN a Quote_Draft has a `null` or empty `customerNote` and no unresolved items, THE JobberQuotePushService SHALL omit the `message` field from the `quoteCreate` mutation attributes.

### Requirement 9: Shared Types Update

**User Story:** As a developer, I want the shared types to reflect the customer note field and new rule action types, so that both client and worker have consistent type definitions.

#### Acceptance Criteria

1. THE `QuoteDraft` interface in `shared/src/types/quote.ts` SHALL include a `customerNote` field of type `string | null`.
2. THE `QuoteDraftUpdate` interface in `shared/src/types/quote.ts` SHALL include an optional `customerNote` field of type `string | null`.
3. THE `RuleActionType` union in `shared/src/types/quote.ts` SHALL include `set_customer_note` and `append_customer_note`.
4. THE `RuleAction` union in `shared/src/types/quote.ts` SHALL include typed variants for `set_customer_note` (with `text: string`) and `append_customer_note` (with `text: string` and optional `separator: string`).
5. THE `RulesEngineResult` interface in `shared/src/types/quote.ts` SHALL include a `customerNote` field of type `string | null`.

### Requirement 10: Rules Engine Audit Trail for Customer Note Actions

**User Story:** As a user, I want to see which rules set or appended to the customer note in the audit trail, so that I can understand how the note was generated.

#### Acceptance Criteria

1. WHEN a `set_customer_note` action fires, THE Rules_Engine SHALL record an AuditEntry with the action details and a `beforeSnapshot` and `afterSnapshot` reflecting the Customer_Note value before and after the action.
2. WHEN an `append_customer_note` action fires, THE Rules_Engine SHALL record an AuditEntry with the action details and a `beforeSnapshot` and `afterSnapshot` reflecting the Customer_Note value before and after the action.
