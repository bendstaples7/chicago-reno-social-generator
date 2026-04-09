# Requirements Document

## Introduction

This feature adds a quote generation section to the existing social media cross-poster tool. The application will gain tab-based top-level navigation separating the existing social media functionality from a new quote generation workflow. In the first increment, users can paste text from customer emails or text messages, upload reference pictures, and generate a draft quote. The system attempts to match customer requests against an existing Jobber product catalog and quote template library. It does not create new products. Items that cannot be matched are surfaced as unresolved asks for the user to handle manually. The system integrates with the Jobber API when available, with a manual data-entry fallback when it is not.

## Glossary

- **App_Shell**: The top-level application container that hosts tab-based navigation and renders the active section (Social Media or Quote Generation).
- **Social_Media_Section**: The existing set of pages (Dashboard, Quick Post, Media Library, Settings, Activity Log) grouped under a tab.
- **Quote_Generation_Section**: The new set of pages for creating and managing draft quotes, grouped under a separate tab.
- **Quote_Input_Form**: The UI component where the user pastes customer request text and uploads reference images.
- **Quote_Draft**: A structured draft quote produced by the system, containing matched line items, a suggested template, and unresolved items.
- **Quote_Engine**: The server-side service that analyzes customer request text and images, matches them against the Product_Catalog and Template_Library, and produces a Quote_Draft.
- **Product_Catalog**: The collection of existing products and services available in Jobber that can be added as line items on a quote.
- **Template_Library**: The collection of existing quote templates in Jobber that can serve as starting points for a Quote_Draft.
- **Unresolved_Items**: Line items from the customer request that the Quote_Engine could not confidently match to any entry in the Product_Catalog.
- **Jobber_Integration**: The server-side module responsible for communicating with the Jobber API to fetch products, templates, and customer requests.
- **Manual_Fallback**: An alternative data-entry mode where the user manually provides product catalog data and quote templates when the Jobber API is unavailable.

## Requirements

### Requirement 1: Tab-Based Navigation

**User Story:** As a user, I want the application to have separate tabs for social media and quote generation, so that I can switch between workflows without losing context.

#### Acceptance Criteria

1. THE App_Shell SHALL render a top-level tab bar with exactly two tabs labeled "Social Media" and "Quotes".
2. WHEN the user selects the "Social Media" tab, THE App_Shell SHALL display the Social_Media_Section containing all existing pages (Dashboard, Quick Post, Media Library, Settings, Activity Log).
3. WHEN the user selects the "Quotes" tab, THE App_Shell SHALL display the Quote_Generation_Section.
4. THE App_Shell SHALL preserve the navigation state within each section when the user switches between tabs.
5. WHEN the application loads, THE App_Shell SHALL default to the last active tab from the previous session, or the "Social Media" tab if no previous session state exists.

### Requirement 2: Customer Request Input

**User Story:** As a user, I want to paste text from customer emails and text messages and upload reference pictures, so that the system has the information it needs to generate a quote.

#### Acceptance Criteria

1. THE Quote_Input_Form SHALL provide a multi-line text field for pasting customer request text.
2. THE Quote_Input_Form SHALL provide a file upload area that accepts image files (JPEG, PNG, HEIC, WebP).
3. THE Quote_Input_Form SHALL allow the user to upload up to 10 images per quote request.
4. WHEN the user has entered text or uploaded at least one image, THE Quote_Input_Form SHALL enable a "Generate Quote" button.
5. IF the user attempts to upload a file that is not an accepted image format, THEN THE Quote_Input_Form SHALL display an inline error message identifying the rejected file and listing accepted formats.
6. IF the user attempts to upload more than 10 images, THEN THE Quote_Input_Form SHALL display an inline error message stating the maximum number of images allowed.

### Requirement 3: Quote Draft Generation

**User Story:** As a user, I want the system to generate a draft quote from the customer request, so that I can quickly respond with an accurate estimate.

#### Acceptance Criteria

1. WHEN the user submits a quote request via the Quote_Input_Form, THE Quote_Engine SHALL analyze the customer request text and any uploaded images.
2. THE Quote_Engine SHALL search the Template_Library for a matching quote template based on the type of work described in the customer request.
3. WHEN a matching template is found, THE Quote_Engine SHALL use the matching template as the starting structure for the Quote_Draft.
4. WHEN no matching template is found, THE Quote_Engine SHALL build the Quote_Draft from scratch using only items from the Product_Catalog.
5. THE Quote_Engine SHALL match each identifiable line item in the customer request to an entry in the Product_Catalog.
6. THE Quote_Engine SHALL include a confidence score (0 to 100) for each matched line item in the Quote_Draft.
7. THE Quote_Engine SHALL assign each line item with a confidence score below 70 to the Unresolved_Items section of the Quote_Draft.
8. THE Quote_Engine SHALL limit matched line items to existing entries in the Product_Catalog and SHALL NOT create new products.

### Requirement 4: Quote Draft Display

**User Story:** As a user, I want to review the generated draft quote with clear sections for matched items and unresolved items, so that I can finalize the quote efficiently.

#### Acceptance Criteria

1. WHEN a Quote_Draft is generated, THE Quote_Generation_Section SHALL display the draft with the following sections: selected template (if any), matched line items, and Unresolved_Items.
2. THE Quote_Generation_Section SHALL display each matched line item with the product name, quantity, unit price, and confidence score.
3. THE Quote_Generation_Section SHALL visually distinguish Unresolved_Items from matched line items using a separate section with a warning indicator.
4. THE Quote_Generation_Section SHALL display each Unresolved_Item with the original text from the customer request and a reason the Quote_Engine could not match the item.
5. WHEN the Quote_Draft contains zero Unresolved_Items, THE Quote_Generation_Section SHALL hide the Unresolved_Items section entirely.
6. WHILE the Quote_Engine is processing a request, THE Quote_Generation_Section SHALL display a loading indicator with a status message.

### Requirement 5: Jobber API Integration

**User Story:** As a user, I want the system to pull products, templates, and customer requests directly from Jobber, so that I always work with up-to-date data.

#### Acceptance Criteria

1. THE Jobber_Integration SHALL authenticate with the Jobber API using OAuth 2.0 credentials stored in server environment variables.
2. WHEN the Quote_Generation_Section loads, THE Jobber_Integration SHALL fetch the current Product_Catalog from the Jobber API.
3. WHEN the Quote_Generation_Section loads, THE Jobber_Integration SHALL fetch the current Template_Library from the Jobber API.
4. THE Jobber_Integration SHALL cache fetched Product_Catalog and Template_Library data for a configurable duration (default: 15 minutes) to reduce API calls.
5. IF the Jobber API returns an error or is unreachable, THEN THE Jobber_Integration SHALL log the error and activate the Manual_Fallback mode.
6. IF the Jobber API returns an error or is unreachable, THEN THE Quote_Generation_Section SHALL display a notification informing the user that the system is operating in Manual_Fallback mode.

### Requirement 6: Manual Fallback Mode

**User Story:** As a user, I want to manually provide product and template data when the Jobber API is unavailable, so that I can still generate quotes.

#### Acceptance Criteria

1. WHILE the system is in Manual_Fallback mode, THE Quote_Generation_Section SHALL display input fields for the user to enter product catalog data (product name, unit price, description).
2. WHILE the system is in Manual_Fallback mode, THE Quote_Generation_Section SHALL allow the user to add, edit, and remove products from a local Product_Catalog.
3. WHILE the system is in Manual_Fallback mode, THE Quote_Generation_Section SHALL allow the user to paste or type quote template content into a template editor.
4. WHILE the system is in Manual_Fallback mode, THE Quote_Engine SHALL use the locally provided Product_Catalog and Template_Library for quote generation.
5. WHEN the Jobber API becomes available again, THE Jobber_Integration SHALL notify the user and offer to switch back to API-sourced data.

### Requirement 7: Quote Draft Data Persistence

**User Story:** As a user, I want my draft quotes to be saved, so that I can return to them later without losing work.

#### Acceptance Criteria

1. WHEN a Quote_Draft is generated, THE Quote_Generation_Section SHALL automatically save the draft to the server database.
2. THE Quote_Generation_Section SHALL display a list of saved Quote_Drafts sorted by creation date (newest first).
3. WHEN the user selects a saved Quote_Draft, THE Quote_Generation_Section SHALL load and display the full draft for review.
4. THE Quote_Generation_Section SHALL allow the user to delete a saved Quote_Draft.
5. WHEN the user modifies a Quote_Draft (editing line items, resolving Unresolved_Items), THE Quote_Generation_Section SHALL save changes within 2 seconds of the last edit.
