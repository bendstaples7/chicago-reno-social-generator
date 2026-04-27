# Requirements Document

## Introduction

This feature adds the ability to push a finalized quote draft from the app directly into Jobber as a Jobber quote. Currently, the app generates AI-powered quote drafts from Jobber customer requests, but the user must manually recreate the quote in Jobber. This feature closes that loop by providing a "Push to Jobber" button on the quote draft page that creates a Jobber quote via the GraphQL API, links it to the correct customer and request, and stores the resulting Jobber quote ID back in the app.

As part of this work, the app's internal quote draft ID must be clearly separated from the Jobber-assigned quote ID. Today the quote title (e.g., "D-001") conflates the app draft number with any Jobber identity. After this feature, each draft will track both its own app-level draft number and, once pushed, the Jobber quote ID and quote number independently.

## Glossary

- **Quote_Draft**: An AI-generated quote stored in the app's D1 database, containing line items matched against a product catalog.
- **Jobber_Quote**: A quote record in the Jobber platform, created via the Jobber GraphQL API `quoteCreate` mutation.
- **Jobber_Quote_ID**: The globally unique encoded ID assigned by Jobber when a quote is created (e.g., `Z2lkOi8vSm9iYmVyL1F1b3RlLzEyMzQ1`).
- **Jobber_Quote_Number**: The human-readable quote number assigned by Jobber (e.g., `Q-42`).
- **App_Draft_Number**: The app's internal sequential draft identifier displayed as `D-001`, `D-002`, etc., independent of any Jobber identity.
- **Push_Service**: The backend service responsible for translating a Quote_Draft into a Jobber_Quote via the Jobber GraphQL API.
- **Quote_Draft_Page**: The client-side page (`QuoteDraftPage.tsx`) that displays a single quote draft and its line items.
- **Jobber_Integration**: The existing service class that handles all Jobber GraphQL API communication, including authentication and token refresh.
- **Line_Item**: A single product entry on a quote, with product name, quantity, unit price, and description.
- **Customer_Request**: A service request from a customer in Jobber, linked to a client record.

## Requirements

### Requirement 1: Separate App Draft Identity from Jobber Quote Identity

**User Story:** As a user, I want the app's internal draft number to be clearly separate from the Jobber quote ID, so that I can distinguish between my app drafts and Jobber quotes without confusion.

#### Acceptance Criteria

1. THE Quote_Draft SHALL store a `jobber_quote_id` field that is null until the draft is pushed to Jobber.
2. THE Quote_Draft SHALL store a `jobber_quote_number` field that is null until the draft is pushed to Jobber.
3. WHEN a Quote_Draft is displayed, THE Quote_Draft_Page SHALL show the App_Draft_Number (e.g., "D-001") as the primary identifier.
4. WHEN a Quote_Draft has been pushed to Jobber, THE Quote_Draft_Page SHALL display the Jobber_Quote_Number alongside the App_Draft_Number.
5. THE Quote_Draft SHALL treat the `id` field as the app-internal identifier, independent of any Jobber_Quote_ID.

### Requirement 2: Push Quote to Jobber Button

**User Story:** As a user, I want a "Push to Jobber" button at the bottom of the quote draft page, so that I can send a finalized quote to Jobber when I am satisfied with it.

#### Acceptance Criteria

1. THE Quote_Draft_Page SHALL display a "Push to Jobber" button at the bottom of the page.
2. WHILE the Quote_Draft status is 'draft', THE Quote_Draft_Page SHALL enable the "Push to Jobber" button.
3. WHEN the Quote_Draft has already been pushed to Jobber (jobber_quote_id is not null), THE Quote_Draft_Page SHALL disable the "Push to Jobber" button and display the existing Jobber_Quote_Number instead.
4. WHILE the push operation is in progress, THE Quote_Draft_Page SHALL display a loading indicator on the button and disable it to prevent duplicate submissions.
5. IF the push operation fails, THEN THE Quote_Draft_Page SHALL display the error message to the user and re-enable the button for retry.

### Requirement 3: Create Quote in Jobber via GraphQL API

**User Story:** As a user, I want my quote draft to be created as a real quote in Jobber, so that it appears in my Jobber account linked to the correct customer and request.

#### Acceptance Criteria

1. WHEN the user clicks "Push to Jobber", THE Push_Service SHALL call the Jobber GraphQL `quoteCreate` mutation to create a new Jobber_Quote.
2. THE Push_Service SHALL link the Jobber_Quote to the customer associated with the original Customer_Request.
3. WHEN the Quote_Draft has a `jobberRequestId`, THE Push_Service SHALL associate the Jobber_Quote with that request.
4. THE Push_Service SHALL set the Jobber_Quote title to include the App_Draft_Number for traceability (e.g., "Draft D-001").
5. IF the Jobber GraphQL API returns an error, THEN THE Push_Service SHALL return a descriptive error message to the client.
6. IF the Jobber API is unavailable or the access token is expired, THEN THE Push_Service SHALL attempt a token refresh before failing.

### Requirement 4: Transfer All Line Items to Jobber Quote

**User Story:** As a user, I want all my quote line items (products, quantities, prices, descriptions) to transfer to the Jobber quote, so that I do not have to re-enter any information.

#### Acceptance Criteria

1. WHEN creating a Jobber_Quote, THE Push_Service SHALL include every resolved Line_Item from the Quote_Draft.
2. FOR EACH Line_Item, THE Push_Service SHALL transfer the product name, quantity, and unit price to the Jobber_Quote.
3. FOR EACH Line_Item that has a `productCatalogEntryId` matching a Jobber product, THE Push_Service SHALL reference the Jobber product ID in the line item.
4. FOR EACH Line_Item, THE Push_Service SHALL include the product description from the catalog entry when available.
5. THE Push_Service SHALL preserve the display order of Line_Items when creating the Jobber_Quote.
6. IF the Quote_Draft contains unresolved items, THEN THE Push_Service SHALL include them as a note or message on the Jobber_Quote so no information is lost.

### Requirement 5: Store Jobber Quote ID After Successful Push

**User Story:** As a user, I want the app to remember which Jobber quote was created from my draft, so that I can reference it later without searching Jobber manually.

#### Acceptance Criteria

1. WHEN the Jobber GraphQL API returns a successful response, THE Push_Service SHALL extract the Jobber_Quote_ID and Jobber_Quote_Number from the response.
2. THE Push_Service SHALL persist the Jobber_Quote_ID and Jobber_Quote_Number to the Quote_Draft record in D1.
3. WHEN the push is complete, THE Quote_Draft_Page SHALL update to display the Jobber_Quote_Number without requiring a page reload.
4. THE Push_Service SHALL update the Quote_Draft status to 'finalized' after a successful push.

### Requirement 6: Link to Jobber Quote and Customer from App

**User Story:** As a user, I want clickable links to the Jobber quote and customer record, so that I can quickly navigate to Jobber to view or edit the quote.

#### Acceptance Criteria

1. WHEN a Quote_Draft has a Jobber_Quote_ID, THE Quote_Draft_Page SHALL display a clickable link that opens the Jobber quote in the Jobber web application.
2. WHEN a Quote_Draft has a linked Customer_Request with a `jobberWebUri`, THE Quote_Draft_Page SHALL display a clickable link to the customer request in Jobber.
3. THE Quote_Draft_Page SHALL open Jobber links in a new browser tab.

### Requirement 7: Database Migration for Jobber Quote Tracking

**User Story:** As a developer, I want the database schema to support storing Jobber quote identifiers on drafts, so that the push-to-Jobber feature has persistent storage.

#### Acceptance Criteria

1. THE database migration SHALL add a `jobber_quote_id` TEXT column to the `quote_drafts` table, defaulting to NULL.
2. THE database migration SHALL add a `jobber_quote_number` TEXT column to the `quote_drafts` table, defaulting to NULL.
3. THE database migration SHALL be a new numbered SQL file following the existing migration naming convention.

### Requirement 8: Resolve Customer ID for Jobber Quote Creation

**User Story:** As a user, I want the system to automatically determine the correct Jobber customer to link the quote to, so that I do not have to manually specify the customer.

#### Acceptance Criteria

1. WHEN the Quote_Draft has a `jobberRequestId`, THE Push_Service SHALL fetch the associated Customer_Request to determine the Jobber client ID.
2. IF the Customer_Request has a linked client record, THEN THE Push_Service SHALL use that client's Jobber ID when creating the Jobber_Quote.
3. IF the Customer_Request does not have a linked client record, THEN THE Push_Service SHALL return an error indicating the customer could not be resolved.
4. IF the Quote_Draft does not have a `jobberRequestId`, THEN THE Push_Service SHALL return an error indicating a Jobber request must be linked before pushing.
