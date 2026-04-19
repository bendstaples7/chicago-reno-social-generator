# Requirements Document

## Introduction

This feature introduces a unified systems check at login/app startup that verifies all external service connections before the user enters the application. If any required connection is missing or expired, the user is prompted to fix it immediately — not mid-flow. The existing `SessionExpiredBanner` component is removed entirely. The result is a clean experience where all integrations are confirmed working before the user starts.

## Glossary

- **Auth_Shell**: The authenticated application shell rendered by `Layout.tsx` after the user passes the `ProtectedRoute` gate. It contains the sidebar navigation and renders child routes.
- **Systems_Check_Gate**: A new client-side component that runs after app login and before rendering the Auth_Shell. It checks all external service connections (Jobber OAuth, Instagram channel) and blocks navigation until all required connections are confirmed.
- **Systems_Check_Endpoint**: A new `GET /api/systems/status` API endpoint that returns the status of all external connections in a single call: Jobber OAuth availability, Instagram channel connection status, and any other required integrations.
- **Jobber_Status_Endpoint**: The existing `GET /api/quotes/jobber/status` API endpoint that returns `{ available: boolean }` indicating whether valid Jobber OAuth tokens exist in D1.
- **OAuth_Flow**: The existing Jobber OAuth authorization flow initiated at `GET /api/jobber-auth/authorize`, which redirects to Jobber, obtains an authorization code, exchanges it for tokens, and persists them to D1.
- **Session_Expired_Banner**: The existing `SessionExpiredBanner.tsx` component that displays a warning banner and "Reconnect" button inside `RequestSelector` when Jobber web session cookies are expired.
- **Auth_Context**: The existing `AuthContext.tsx` React context that manages user login state, session verification, and provides `user`, `loading`, `login`, and `logout` to the component tree.
- **Quote_Input_Page**: The existing `QuoteInputPage.tsx` page component where users create new quotes, which currently checks Jobber status on mount and conditionally renders the `RequestSelector`.
- **Request_Selector**: The existing `RequestSelector.tsx` component that lists Jobber customer requests and currently renders the Session_Expired_Banner when the web session is expired.

## Requirements

### Requirement 1: Unified Systems Check on App Startup

**User Story:** As a user, I want all external service connections verified immediately after I log in, so that I never encounter authentication or connection errors while working.

#### Acceptance Criteria

1. WHEN a user successfully authenticates via the login page, THE Systems_Check_Gate SHALL call the Systems_Check_Endpoint to verify all external connections before rendering the Auth_Shell.
2. WHEN the Auth_Context finishes session verification on app reload (page refresh with existing token), THE Systems_Check_Gate SHALL call the Systems_Check_Endpoint before rendering the Auth_Shell.
3. WHILE the Systems_Check_Gate is checking connection status, THE Systems_Check_Gate SHALL display a loading indicator to the user.
4. WHEN all connections are healthy, THE Systems_Check_Gate SHALL render the Auth_Shell and allow the user to proceed.
5. THE Systems_Check_Endpoint SHALL return the status of: Jobber OAuth tokens (available/unavailable), Instagram channel (connected/expired/not connected), and any other required integrations, in a single response.
6. IF the Systems_Check_Endpoint call fails due to a network error, THEN THE Systems_Check_Gate SHALL display an error message with a retry option.

### Requirement 2: Automatic Re-authentication for Failed Connections

**User Story:** As a user, I want to be prompted to fix any broken connections immediately at startup, so that I can resolve issues before starting work.

#### Acceptance Criteria

1. WHEN the Systems_Check_Endpoint reports Jobber OAuth as unavailable, THE Systems_Check_Gate SHALL display a prompt with an action to initiate the Jobber OAuth_Flow by redirecting to `GET /api/jobber-auth/authorize`.
2. WHEN the Systems_Check_Endpoint reports Instagram channel as expired or not connected, THE Systems_Check_Gate SHALL display a prompt directing the user to reconnect Instagram via Settings.
3. WHEN the user completes a re-authentication flow and returns to the application, THE Systems_Check_Gate SHALL re-check all connections via the Systems_Check_Endpoint.
4. WHEN the re-check confirms all connections are healthy, THE Systems_Check_Gate SHALL render the Auth_Shell and allow the user to proceed.
5. THE Systems_Check_Gate SHALL allow the user to skip non-critical connection issues (e.g., Instagram not connected) and proceed to the app, while blocking on critical issues (e.g., Jobber OAuth unavailable).

### Requirement 3: Remove SessionExpiredBanner Component

**User Story:** As a user, I want the mid-flow session expired banner removed, so that I have a clean quote creation experience without unexpected interruptions.

#### Acceptance Criteria

1. THE Request_Selector SHALL render without any session expiration banner or reconnect prompt.
2. THE Quote_Input_Page SHALL not track or manage `sessionExpired` state.
3. THE Request_Selector SHALL not accept `sessionExpired` or `onReconnected` props.
4. THE Session_Expired_Banner component file (`SessionExpiredBanner.tsx`) SHALL be deleted from the codebase.

### Requirement 4: Clean Up Jobber Session Status Dependencies

**User Story:** As a developer, I want unused Jobber web session status code removed from the client, so that the codebase stays maintainable and free of dead code.

#### Acceptance Criteria

1. THE Quote_Input_Page SHALL not call `checkJobberSessionStatus` or `fetchJobberRequestFormData` with session expiration handling logic.
2. THE client API module SHALL not export the `checkJobberSessionStatus` function.
3. WHEN `fetchJobberRequestFormData` returns `sessionExpired: true`, THE Quote_Input_Page SHALL ignore the session expiration flag and continue with available data (description, notes fallback).

### Requirement 5: OAuth Callback Return Handling

**User Story:** As a user, I want to be returned to the application seamlessly after completing Jobber OAuth, so that I can start working without manual navigation.

#### Acceptance Criteria

1. WHEN the OAuth_Flow callback completes token exchange successfully, THE OAuth callback handler SHALL redirect the browser back to the application root path instead of displaying an HTML confirmation page.
2. WHEN the browser returns to the application after OAuth_Flow completion, THE Jobber_Auth_Gate SHALL detect the successful authentication and render the Auth_Shell.
3. IF the OAuth_Flow callback fails during token exchange, THEN THE OAuth callback handler SHALL redirect the browser back to the application with an error query parameter.
4. WHEN the application loads with an OAuth error query parameter, THE Jobber_Auth_Gate SHALL display the error message with a retry option.

### Requirement 6: Dashboard Instagram Sync Must Not Trigger Error Toast

**User Story:** As a user, I want the Dashboard to load cleanly without error toasts caused by background sync operations, so that I am not confused by irrelevant error messages.

#### Acceptance Criteria

1. WHEN the DashboardPage mounts and calls `syncInstagramPosts()` as a fire-and-forget background operation, THE call SHALL NOT trigger the global error toast if the sync endpoint returns an error (e.g., no connected Instagram account, expired token, server error).
2. THE DashboardPage sync call SHALL bypass the `handleResponse` global error listener by calling the sync endpoint directly via `fetch` instead of using the `syncInstagramPosts` API wrapper, OR the API layer SHALL provide a silent variant that suppresses the global error listener for fire-and-forget calls.
3. WHEN the sync succeeds, THE behavior SHALL remain unchanged — synced posts appear on the next Dashboard visit or page refresh.

### Requirement 7: Jobber Request Background Enrichment in Worker

**User Story:** As a user, I want incomplete Jobber request details to be automatically fetched in the background, so that I see full request information without manual intervention.

#### Acceptance Criteria

1. WHEN the worker's `GET /jobber/requests` handler returns the request list, THE handler SHALL identify requests that lack detailed data (empty description, no notes/structuredNotes, no imageUrls).
2. FOR up to 5 incomplete requests, THE handler SHALL fire-and-forget calls to fetch full details from the Jobber public API and store them in the `jobber_webhook_requests` table using the existing upsert pattern.
3. THE enrichment SHALL be non-blocking — the response SHALL return immediately with whatever data is currently available.
4. EACH enrichment call SHALL be individually wrapped in try/catch so individual failures do not affect others or the response.

### Requirement 8: Suppress Error Toasts for Handled/Fallback API Calls

**User Story:** As a user, I want to only see error toasts for errors that actually affect my workflow, not for errors that are silently handled by fallback logic.

#### Acceptance Criteria

1. THE client API layer SHALL provide a mechanism to make API calls without triggering the global error toast (e.g., a `{ silent: true }` option or a separate `fetchSilent` helper that does not call `globalErrorListener`).
2. WHEN `fetchJobberRequestFormData` fails and the QuoteInputPage falls back to building form data from webhook/API data, THE failure SHALL NOT trigger a global error toast.
3. WHEN `fetchCorpusStatus` fails during polling in CorpusStatusIndicator, THE failure SHALL NOT trigger a global error toast (polling errors are transient and expected).
4. WHEN `checkJobberStatus` fails on QuoteInputPage mount and the page falls back to `jobberAvailable: false`, THE failure SHALL NOT trigger a global error toast.
