# Requirements Document

## Introduction

This feature adds iterative natural-language feedback and revision capabilities to the existing quote draft system. Users can review a generated quote draft and provide free-form feedback (e.g., "move underlayment before hardwood installation", "increase drywall quantity to 12", "remove the painting line item"). The system interprets the feedback using AI, applies the requested changes to the draft's line items, and presents the updated draft. This cycle repeats until the user is satisfied with the quote.

## Glossary

- **Quote_Draft**: A generated quote containing resolved line items, unresolved items, and metadata. Identified by a draft number (e.g., D-001).
- **Line_Item**: A single product or service entry on a quote draft, with product name, quantity, unit price, confidence score, and display order.
- **Feedback_Input**: A natural-language message from the user describing desired changes to a quote draft.
- **Revision_Engine**: The AI-powered component that interprets a Feedback_Input against the current Quote_Draft and produces a revised set of line items.
- **Revision_History**: An ordered log of all feedback messages and the resulting draft states for a single Quote_Draft.
- **Product_Catalog**: The set of available products and services (from Jobber or manual entry) used to validate and price line items.

## Requirements

### Requirement 1: Submit Feedback on a Quote Draft

**User Story:** As a user, I want to type natural-language feedback on a quote draft, so that I can request changes without manually editing individual line items.

#### Acceptance Criteria

1. WHEN the user is viewing a Quote_Draft with status "draft", THE QuoteDraftPage SHALL display a feedback text input area.
2. WHEN the user submits a non-empty Feedback_Input, THE QuoteDraftPage SHALL send the feedback to the Revision_Engine along with the current Quote_Draft state.
3. WHILE the Revision_Engine is processing feedback, THE QuoteDraftPage SHALL display a loading indicator and disable the feedback input.
4. IF the Feedback_Input is empty or contains only whitespace, THEN THE QuoteDraftPage SHALL prevent submission and display a validation message.

### Requirement 2: AI-Powered Draft Revision

**User Story:** As a user, I want the system to interpret my feedback and update the quote accordingly, so that I can make changes by describing what I want in plain language.

#### Acceptance Criteria

1. WHEN the Revision_Engine receives a Feedback_Input and the current Quote_Draft line items, THE Revision_Engine SHALL produce a revised set of line items reflecting the requested changes.
2. THE Revision_Engine SHALL support reordering line items (e.g., "move underlayment before hardwood installation").
3. THE Revision_Engine SHALL support changing quantities on existing line items (e.g., "increase drywall to 12 sheets").
4. THE Revision_Engine SHALL support adjusting unit prices on existing line items (e.g., "change labor rate to $75/hour").
5. THE Revision_Engine SHALL support removing line items from the draft (e.g., "remove the painting line item").
6. THE Revision_Engine SHALL support adding new line items by matching against the Product_Catalog (e.g., "add trim installation").
7. WHEN the Revision_Engine adds a new line item, THE Revision_Engine SHALL match the item against the Product_Catalog and use catalog pricing when a match is found.
8. WHEN the Revision_Engine cannot match a new item to the Product_Catalog, THE Revision_Engine SHALL add the item as an unresolved item with a descriptive reason.
9. THE Revision_Engine SHALL preserve all line items that are not referenced in the Feedback_Input without modification.

### Requirement 3: Display Revised Draft

**User Story:** As a user, I want to see the updated quote immediately after providing feedback, so that I can verify the changes are correct.

#### Acceptance Criteria

1. WHEN the Revision_Engine returns a revised draft, THE QuoteDraftPage SHALL update the displayed line items, unresolved items, and totals to reflect the revision.
2. WHEN the revision completes, THE QuoteDraftPage SHALL clear the feedback input and re-enable it for further feedback.
3. WHEN the revision completes, THE QuoteDraftService SHALL persist the updated line items and unresolved items to the database.

### Requirement 4: Iterative Feedback Rounds

**User Story:** As a user, I want to provide multiple rounds of feedback on the same draft, so that I can incrementally refine the quote until it is correct.

#### Acceptance Criteria

1. WHEN a revision completes, THE QuoteDraftPage SHALL allow the user to submit additional Feedback_Input on the same Quote_Draft.
2. WHEN the user submits a subsequent Feedback_Input, THE Revision_Engine SHALL operate on the most recently revised line items of the Quote_Draft.
3. THE Revision_History SHALL record each Feedback_Input message and a timestamp for the Quote_Draft.
4. THE QuoteDraftPage SHALL display the Revision_History as a scrollable list of past feedback messages below the feedback input.

### Requirement 5: Revision History Persistence

**User Story:** As a user, I want my feedback history to be saved, so that I can review what changes I requested when I return to a draft later.

#### Acceptance Criteria

1. THE QuoteDraftService SHALL persist each Revision_History entry (feedback text and timestamp) to the database when a revision completes.
2. WHEN the user navigates to a Quote_Draft, THE QuoteDraftPage SHALL load and display the full Revision_History for that draft.
3. THE Revision_History entries SHALL be displayed in chronological order, oldest first.

### Requirement 6: Error Handling During Revision

**User Story:** As a user, I want clear error messages if the revision fails, so that I know what happened and can try again.

#### Acceptance Criteria

1. IF the Revision_Engine API call fails due to a network error, THEN THE QuoteDraftPage SHALL display an error message and re-enable the feedback input so the user can retry.
2. IF the Revision_Engine returns an unparseable response, THEN THE Revision_Engine SHALL return the original draft line items unchanged and include an error description.
3. IF the AI service times out, THEN THE Revision_Engine SHALL return an error within 30 seconds.
