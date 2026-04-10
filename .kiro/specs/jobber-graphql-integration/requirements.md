# Requirements Document

## Introduction

The existing quote generation feature integrates with Jobber to fetch product catalog data and quote templates. However, the current implementation uses REST API calls (e.g., `GET /products`, `GET /templates`) against endpoints that do not exist — Jobber exclusively provides a GraphQL API at `https://api.getjobber.com/api/graphql`. As a result, every Jobber fetch fails, the integration falls back to manual mode with an empty catalog, and the quote engine produces drafts where all items show as "unresolved" because there is no catalog data to match against.

This feature replaces the broken REST-based Jobber integration with a working GraphQL implementation. It adds the ability to fetch products/line items, quote templates, and customer requests from Jobber's GraphQL API. It also enhances the quote input workflow so users can select a Jobber customer request directly instead of copy-pasting text. The app has a Jobber developer app with scopes: `read_clients`, `read_requests`, `read_quotes`.

Both the Express server (`server/src/services/jobber-integration.ts`) and the Cloudflare Worker (`worker/src/services/jobber-integration.ts`) implementations must be updated.

## Glossary

- **Jobber_Integration**: The server-side module responsible for communicating with the Jobber GraphQL API to fetch products, templates, and customer requests.
- **GraphQL_Client**: The internal HTTP client component within Jobber_Integration that sends GraphQL queries to `https://api.getjobber.com/api/graphql`.
- **Product_Catalog**: The collection of products and services fetched from Jobber via the `productsAndServices` GraphQL query, used as line items on quotes.
- **Template_Library**: The collection of quote templates fetched from Jobber via the GraphQL API.
- **Customer_Request**: A service request record in Jobber (fetched via the `requests` GraphQL query) containing the customer's description of work needed, contact information, and job details.
- **Request_Selector**: A UI component on the Quote Input page that displays a list of Jobber customer requests and allows the user to select one as the basis for quote generation.
- **Quote_Engine**: The server-side service that analyzes customer request text, matches items against the Product_Catalog, and produces a Quote_Draft.
- **Quote_Input_Form**: The UI component where the user provides customer request text (manually or via Request_Selector) and uploads reference images.
- **Manual_Fallback**: The alternative data-entry mode activated when the Jobber API is unavailable, where the user manually provides catalog data.
- **Pagination_Cursor**: An opaque string returned by Jobber's GraphQL API used to fetch subsequent pages of results in cursor-based pagination.

## Requirements

### Requirement 1: GraphQL API Communication

**User Story:** As a developer, I want the Jobber integration to communicate via GraphQL instead of REST, so that the integration actually works with Jobber's real API.

#### Acceptance Criteria

1. THE GraphQL_Client SHALL send all Jobber API requests as HTTP POST requests to `https://api.getjobber.com/api/graphql` with a JSON body containing `query` and `variables` fields.
2. THE GraphQL_Client SHALL include an `Authorization: Bearer <access_token>` header on every request to the Jobber GraphQL API.
3. THE GraphQL_Client SHALL include a `Content-Type: application/json` header on every request.
4. IF the Jobber GraphQL API returns a response containing a top-level `errors` array, THEN THE GraphQL_Client SHALL treat the response as a failure and extract the first error message for logging.
5. IF the Jobber GraphQL API does not respond within 10 seconds, THEN THE GraphQL_Client SHALL abort the request and treat it as a timeout failure.
6. THE GraphQL_Client SHALL be implemented in both the Express server (`server/src/services/jobber-integration.ts`) and the Cloudflare Worker (`worker/src/services/jobber-integration.ts`) variants.

### Requirement 2: Fetch Product Catalog via GraphQL

**User Story:** As a user, I want the system to fetch real products from Jobber, so that the quote engine can match customer requests against actual catalog items.

#### Acceptance Criteria

1. WHEN the Jobber_Integration fetches the Product_Catalog, THE GraphQL_Client SHALL execute a `productsAndServices` query requesting the fields: `id`, `name`, `description`, `defaultUnitCost`, and `category`.
2. THE Jobber_Integration SHALL handle Jobber's cursor-based pagination by following `pageInfo.hasNextPage` and `pageInfo.endCursor` until all products are fetched.
3. THE Jobber_Integration SHALL map each Jobber product node to a `ProductCatalogEntry` with `unitPrice` set from the `defaultUnitCost` field.
4. THE Jobber_Integration SHALL cache the fetched Product_Catalog in memory with a configurable TTL (default: 15 minutes).
5. IF the `productsAndServices` query fails, THEN THE Jobber_Integration SHALL log the error, set availability to false, and return an empty array.

### Requirement 3: Fetch Quote Templates via GraphQL

**User Story:** As a user, I want the system to fetch quote templates from Jobber, so that generated quotes can use existing template structures.

#### Acceptance Criteria

1. WHEN the Jobber_Integration fetches the Template_Library, THE GraphQL_Client SHALL execute a GraphQL query for quote-related data requesting template fields including `id`, `name`, `message`, and `category` (or equivalent fields available in the Jobber schema).
2. THE Jobber_Integration SHALL handle cursor-based pagination for template queries.
3. THE Jobber_Integration SHALL map each Jobber template node to a `QuoteTemplate` with the `content` field set from the template's message or body field.
4. THE Jobber_Integration SHALL cache the fetched Template_Library in memory with the same configurable TTL as the Product_Catalog.
5. IF the template query fails, THEN THE Jobber_Integration SHALL log the error, set availability to false, and return an empty array.

### Requirement 4: Fetch Customer Requests via GraphQL

**User Story:** As a user, I want to see my Jobber customer requests in the app, so that I can select one to generate a quote from instead of copy-pasting text.

#### Acceptance Criteria

1. THE Jobber_Integration SHALL provide a `fetchCustomerRequests` method that executes a `requests` GraphQL query requesting the fields: `id`, `title`, `companyName` (or client name), `createdAt`, and the request details/description.
2. THE Jobber_Integration SHALL handle cursor-based pagination for the requests query.
3. THE Jobber_Integration SHALL return customer requests sorted by creation date (newest first).
4. THE Jobber_Integration SHALL cache fetched customer requests in memory with the same configurable TTL as other cached data.
5. IF the requests query fails, THEN THE Jobber_Integration SHALL log the error and return an empty array without setting the overall integration availability to false (the user can still enter text manually).

### Requirement 5: Customer Request Selector UI

**User Story:** As a user, I want to pick a customer request from a list on the quote input page, so that I do not have to copy-paste text from Jobber manually.

#### Acceptance Criteria

1. WHEN the Jobber_Integration is available, THE Quote_Input_Form SHALL display a Request_Selector component above the manual text input area.
2. THE Request_Selector SHALL display a list of recent customer requests showing the request title, client name, and creation date.
3. WHEN the user selects a customer request from the Request_Selector, THE Quote_Input_Form SHALL populate the customer request text area with the selected request's description text.
4. WHEN the user selects a customer request, THE Quote_Input_Form SHALL store the selected Jobber request ID for inclusion in the quote generation payload.
5. THE Request_Selector SHALL allow the user to clear the selection and type custom text instead.
6. WHILE the Request_Selector is loading customer requests, THE Request_Selector SHALL display a loading indicator.
7. IF the Request_Selector fails to load customer requests, THEN THE Request_Selector SHALL display an inline message and allow the user to continue with manual text entry.

### Requirement 6: Quote Generation API Route Updates

**User Story:** As a developer, I want the quote generation routes to support the new Jobber request selection flow, so that the backend can process quotes from Jobber requests.

#### Acceptance Criteria

1. THE quote generation endpoint (`POST /api/quotes/generate`) SHALL accept an optional `jobberRequestId` field in the request body.
2. WHEN a `jobberRequestId` is provided, THE quote generation route SHALL store the Jobber request ID on the resulting Quote_Draft for traceability.
3. THE quote generation route SHALL expose a new endpoint (`GET /api/quotes/jobber/requests`) that returns the list of customer requests from the Jobber_Integration.
4. IF the Jobber_Integration is unavailable when the requests endpoint is called, THEN THE endpoint SHALL return an empty array with a status indicator.

### Requirement 7: Shared Type Updates

**User Story:** As a developer, I want the shared types to reflect the new Jobber request data, so that the client and server have a consistent contract.

#### Acceptance Criteria

1. THE shared types SHALL include a `JobberCustomerRequest` interface with fields: `id` (string), `title` (string), `clientName` (string), `description` (string), and `createdAt` (string).
2. THE `QuoteDraft` interface SHALL include an optional `jobberRequestId` field of type `string | null`.
3. THE shared types SHALL export the `JobberCustomerRequest` interface from the shared package entry point.

### Requirement 8: Graceful Fallback Behavior

**User Story:** As a user, I want the system to fall back to manual mode gracefully when Jobber is unavailable, so that I can still generate quotes.

#### Acceptance Criteria

1. IF the Jobber GraphQL API returns an authentication error (HTTP 401 or GraphQL authorization error), THEN THE Jobber_Integration SHALL log the error and set availability to false.
2. IF the Jobber GraphQL API returns a rate-limit error (HTTP 429), THEN THE Jobber_Integration SHALL log the error and set availability to false.
3. WHEN the Jobber_Integration availability is false, THE Quote_Input_Form SHALL hide the Request_Selector and display only the manual text input.
4. WHEN the Jobber_Integration availability transitions from false to true on a subsequent successful fetch, THE Jobber_Integration SHALL restore availability to true.

### Requirement 9: GraphQL Response Parsing

**User Story:** As a developer, I want robust parsing of Jobber's GraphQL responses, so that malformed or unexpected data does not crash the application.

#### Acceptance Criteria

1. THE GraphQL_Client SHALL validate that the response body is valid JSON before attempting to extract data.
2. IF a GraphQL response contains a `data` field with null values for requested nodes, THEN THE Jobber_Integration SHALL treat the null nodes as empty collections and continue processing.
3. THE Jobber_Integration SHALL extract product nodes from the `data.productsAndServices.edges[].node` path in the GraphQL response.
4. IF the GraphQL response structure does not match the expected shape (missing `data`, `edges`, or `node` fields), THEN THE Jobber_Integration SHALL log a descriptive error and return an empty result.
