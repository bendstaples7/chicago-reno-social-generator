# Requirements Document

## Introduction

The Quote Action Items feature adds actionable callouts to the quote draft page for items that need user input before the quote can be finalized. During AI-powered quote generation, some line items cannot be fully priced because they depend on information the customer didn't provide — such as square footage for flooring installation, the number of cabinets to install, or other measurements and quantities. These action items are displayed alongside the existing unresolved items section and include checkboxes so the user can track progress as they gather the needed information and update the quote accordingly.

## Glossary

- **Quote_Engine**: The AI-powered service (`QuoteEngine`) that generates quote drafts from customer request text and a product catalog.
- **Action_Item**: A callout attached to a quote draft that identifies a line item needing additional user input (e.g., square footage, quantity) before it can be accurately priced.
- **Quote_Draft_Page**: The React page component (`QuoteDraftPage`) that displays a single quote draft with its line items, unresolved items, and revision tools.
- **Action_Items_Panel**: The UI component on the Quote_Draft_Page that renders the list of Action_Items with checkboxes and descriptive text.
- **Quote_Draft_Service**: The backend service (`QuoteDraftService`) responsible for persisting and retrieving quote drafts from the D1 database.
- **Quote_API**: The Hono route handler layer (`worker/src/routes/quotes.ts`) that exposes quote draft endpoints.
- **Line_Item**: A matched product entry (`QuoteLineItem`) within a quote draft, containing product name, quantity, unit price, and confidence score.

## Requirements

### Requirement 1: Detect Action Items During Quote Generation

**User Story:** As a user, I want the quote engine to automatically identify line items that need additional input from me, so that I know what information to gather before finalizing the quote.

#### Acceptance Criteria

1. WHEN a quote draft is generated from customer request text, THE Quote_Engine SHALL analyze each line item and produce an Action_Item for any line item that requires user-provided measurements, quantities, or other input not present in the customer request.
2. WHEN a line item requires square footage to determine pricing, THE Quote_Engine SHALL generate an Action_Item with a description indicating that square footage is needed.
3. WHEN a line item requires an unknown quantity (e.g., number of cabinets, number of fixtures), THE Quote_Engine SHALL generate an Action_Item with a description indicating the specific quantity needed.
4. THE Quote_Engine SHALL associate each Action_Item with exactly one Line_Item by referencing the Line_Item identifier.
5. THE Quote_Engine SHALL set each generated Action_Item to an incomplete state by default.

### Requirement 2: Persist Action Items on Quote Drafts

**User Story:** As a user, I want action items to be saved with my quote draft, so that I can return to the draft later and see which items still need attention.

#### Acceptance Criteria

1. WHEN a quote draft is saved, THE Quote_Draft_Service SHALL persist all associated Action_Items to the D1 database.
2. WHEN a quote draft is retrieved, THE Quote_Draft_Service SHALL return all associated Action_Items along with the draft data.
3. THE Quote_Draft_Service SHALL store each Action_Item with an identifier, a reference to its parent quote draft, a reference to its associated Line_Item, a description of the required input, and a completion status.
4. WHEN a quote draft is deleted, THE Quote_Draft_Service SHALL delete all associated Action_Items.

### Requirement 3: Display Action Items on the Quote Draft Page

**User Story:** As a user, I want to see a clear list of items that need my attention on the quote draft page, so that I can quickly understand what's blocking the quote from being finalized.

#### Acceptance Criteria

1. WHEN a quote draft has one or more Action_Items, THE Quote_Draft_Page SHALL display the Action_Items_Panel in the same visual area as the unresolved items section.
2. WHEN a quote draft has zero Action_Items, THE Quote_Draft_Page SHALL hide the Action_Items_Panel.
3. THE Action_Items_Panel SHALL display each Action_Item with a checkbox, the associated Line_Item product name, and a description of the required input.
4. THE Action_Items_Panel SHALL visually distinguish itself from the unresolved items section using a distinct heading and icon.
5. THE Action_Items_Panel SHALL display the count of incomplete Action_Items in its heading.

### Requirement 4: Mark Action Items as Complete

**User Story:** As a user, I want to check off action items as I address them, so that I can track my progress toward finalizing the quote.

#### Acceptance Criteria

1. WHEN the user clicks the checkbox on an Action_Item, THE Quote_Draft_Page SHALL toggle the completion status of that Action_Item.
2. WHEN the user toggles an Action_Item completion status, THE Quote_API SHALL persist the updated status to the database.
3. WHEN an Action_Item is marked as complete, THE Action_Items_Panel SHALL render that item with a visual strikethrough or muted style to indicate completion.
4. IF the update to an Action_Item completion status fails, THEN THE Quote_Draft_Page SHALL revert the checkbox to its previous state and display an error message.

### Requirement 5: Action Item Data Model

**User Story:** As a developer, I want a well-defined Action_Item type in the shared types package, so that the client and worker can exchange action item data with type safety.

#### Acceptance Criteria

1. THE shared types package SHALL export an `ActionItem` interface containing: `id` (string), `quoteDraftId` (string), `lineItemId` (string), `description` (string), and `completed` (boolean).
2. THE `QuoteDraft` interface SHALL include an `actionItems` field containing an array of `ActionItem` objects.
3. THE `QuoteDraftUpdate` interface SHALL include an optional `actionItems` field for updating action items when saving a draft.

### Requirement 6: Update Action Items via API

**User Story:** As a user, I want action item changes to be saved through the existing draft update endpoint, so that the system remains consistent without requiring a separate API.

#### Acceptance Criteria

1. WHEN the client sends a PUT request to the draft update endpoint with an `actionItems` field, THE Quote_API SHALL persist the updated action items to the database.
2. WHEN the client sends a PUT request to the draft update endpoint without an `actionItems` field, THE Quote_API SHALL leave existing action items unchanged.
3. THE Quote_API SHALL validate that each Action_Item in the update payload contains a valid `id`, `lineItemId`, `description`, and `completed` field before persisting.
4. IF the update payload contains an Action_Item with an invalid or missing required field, THEN THE Quote_API SHALL return a structured error response with a descriptive message.

### Requirement 7: Regenerate Action Items on Quote Revision

**User Story:** As a user, I want action items to be refreshed when I revise a quote, so that new action items are detected if the revision introduces line items that need additional input.

#### Acceptance Criteria

1. WHEN a quote draft is revised via the feedback endpoint, THE Quote_Engine SHALL re-analyze the revised line items and generate a new set of Action_Items.
2. WHEN a revised set of Action_Items is generated, THE Quote_Draft_Service SHALL replace the previous Action_Items with the new set.
3. WHEN a previously completed Action_Item corresponds to a line item that still exists after revision and still requires the same input, THE Quote_Engine SHALL preserve the completed status of that Action_Item.
