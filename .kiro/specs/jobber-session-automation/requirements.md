# Requirements Document

## Introduction

The Jobber Session Automation feature ensures that the deployed Cloudflare Worker always has valid Jobber web session cookies for accessing Jobber's internal GraphQL API. This API exposes `requestDetails.form` data (the customer's original request submission text) that is not available through Jobber's public GraphQL API. Currently, cookies are only refreshed during local development via a Puppeteer-based startup script (`sync-cookies.mjs`), and the production worker has no automated cookie refresh mechanism. When cookies expire (~4 hours), the form data endpoint silently falls back to incomplete data.

This feature introduces two complementary mechanisms: (1) a GitHub Actions scheduled workflow that automatically refreshes cookies and pushes them to production D1 every 3 hours, and (2) a client-side re-authentication UI that detects expired cookies and prompts the user to re-authenticate as a fallback when the automated refresh fails.

## Glossary

- **Cookie_Refresh_Workflow**: The GitHub Actions scheduled workflow that runs headless Puppeteer to log into Jobber, extract session cookies, and write them to the production D1 database.
- **Session_Cookie**: A set of HTTP cookies obtained from Jobber's web login that authenticate requests to Jobber's internal GraphQL API at `https://api.getjobber.com/api/graphql?location=j`.
- **Internal_API**: Jobber's internal GraphQL API endpoint (`https://api.getjobber.com/api/graphql?location=j`) that requires web session cookies and exposes `requestDetails.form` data not available through the public API.
- **Form_Data**: The customer's original request submission text and structured form answers retrieved from the Internal_API via the `requestDetails.form` GraphQL field.
- **Cookie_Store**: The `jobber_web_session` table in Cloudflare D1 with columns `id`, `cookies`, `expires_at`, and `updated_at`, keyed by `id = 'default'`.
- **Worker**: The Cloudflare Worker (`social-media-cross-poster`) that serves the API, including the form-data endpoint.
- **Client_App**: The React SPA that displays Jobber request details and quote input forms.
- **Re_Auth_UI**: A client-side UI component that detects expired session cookies and prompts the user to re-authenticate with Jobber.
- **Session_Status_Endpoint**: A Worker API endpoint that reports whether valid (non-expired) session cookies exist in the Cookie_Store.
- **Sync_Script**: The existing `worker/scripts/sync-cookies.mjs` Puppeteer-based script that logs into Jobber and extracts session cookies.

## Requirements

### Requirement 1: Scheduled Cookie Refresh via GitHub Actions

**User Story:** As a developer, I want Jobber web session cookies to be automatically refreshed on a schedule, so that the deployed Worker always has valid cookies for fetching customer request form data without manual intervention.

#### Acceptance Criteria

1. THE Cookie_Refresh_Workflow SHALL execute on a cron schedule of every 3 hours.
2. THE Cookie_Refresh_Workflow SHALL also be triggerable manually via `workflow_dispatch`.
3. WHEN the Cookie_Refresh_Workflow executes, THE Cookie_Refresh_Workflow SHALL launch a headless Chromium browser, navigate to `https://secure.getjobber.com/login`, and authenticate using credentials stored in GitHub Actions secrets `JOBBER_WEB_EMAIL` and `JOBBER_WEB_PASSWORD`.
4. WHEN the Cookie_Refresh_Workflow authenticates successfully, THE Cookie_Refresh_Workflow SHALL extract all cookies from the `getjobber.com` domain.
5. WHEN cookies are extracted, THE Cookie_Refresh_Workflow SHALL validate the cookies by making a test request to the Internal_API.
6. WHEN cookies are validated, THE Cookie_Refresh_Workflow SHALL write the cookies to the production Cookie_Store using `wrangler d1 execute DB --remote` with an `expires_at` value of 4 hours from the current time.
7. IF the Jobber login page is unreachable or times out after 60 seconds, THEN THE Cookie_Refresh_Workflow SHALL exit with a non-zero status code and log the failure reason.
8. IF authentication fails (the browser remains on the login page after form submission), THEN THE Cookie_Refresh_Workflow SHALL exit with a non-zero status code and log that credentials are invalid or login was rejected.
9. IF the cookie validation test request to the Internal_API fails, THEN THE Cookie_Refresh_Workflow SHALL exit with a non-zero status code and log that the extracted cookies are not valid.
10. THE Cookie_Refresh_Workflow SHALL use `headless: 'new'` mode and a realistic desktop user agent string to avoid Cloudflare bot detection on the Jobber login page.

### Requirement 2: Reusable Cookie Refresh Script

**User Story:** As a developer, I want the Puppeteer login and cookie extraction logic to be a single reusable script, so that both the GitHub Actions workflow and local development use the same code path.

#### Acceptance Criteria

1. THE Sync_Script SHALL accept a `--target` argument with values `local`, `remote`, or `both` to control where cookies are written.
2. WHEN `--target` is `remote`, THE Sync_Script SHALL write cookies to the production Cookie_Store using `wrangler d1 execute DB --remote`.
3. WHEN `--target` is `local`, THE Sync_Script SHALL write cookies to the local D1 database using `wrangler d1 execute DB --local`.
4. WHEN `--target` is `both`, THE Sync_Script SHALL write cookies to both local and production D1 databases.
5. THE Sync_Script SHALL read credentials from environment variables `JOBBER_WEB_EMAIL` and `JOBBER_WEB_PASSWORD` when `.dev.vars` is not available (CI environment).
6. THE Sync_Script SHALL exit with code 0 on success and code 1 on failure.
7. THE Sync_Script SHALL retain the existing behavior of checking for valid cookies before performing a login, skipping the login when valid cookies already exist in the target store.

### Requirement 3: Session Status API Endpoint

**User Story:** As a developer, I want an API endpoint that reports the current session cookie status, so that the Client_App can detect when cookies have expired and trigger re-authentication.

#### Acceptance Criteria

1. THE Worker SHALL expose a `GET /api/jobber-auth/session-cookies/status` endpoint that returns the cookie validity status.
2. WHEN valid (non-expired) cookies exist in the Cookie_Store, THE Session_Status_Endpoint SHALL return `{ "configured": true, "expired": false }`.
3. WHEN cookies exist in the Cookie_Store but have expired, THE Session_Status_Endpoint SHALL return `{ "configured": true, "expired": true }`.
4. WHEN no cookies exist in the Cookie_Store, THE Session_Status_Endpoint SHALL return `{ "configured": false, "expired": false }`.

### Requirement 4: Form Data Endpoint Expiration Signaling

**User Story:** As a developer, I want the form data endpoint to signal when cookies have expired, so that the Client_App can distinguish between "no form data available" and "cookies expired, re-auth needed."

#### Acceptance Criteria

1. WHEN the form-data endpoint (`GET /api/quotes/jobber/requests/:id/form-data`) attempts to fetch from the Internal_API and the cookies are expired or missing, THE Worker SHALL include `"sessionExpired": true` in the JSON response alongside the fallback `formData`.
2. WHEN the form-data endpoint fetches form data successfully using valid cookies, THE Worker SHALL include `"sessionExpired": false` in the JSON response.
3. WHEN the Internal_API returns a 401 or 403 status or an "unauthenticated" GraphQL error, THE Worker SHALL treat this as an expired session and include `"sessionExpired": true` in the response.

### Requirement 5: Client-Side Session Expiration Detection

**User Story:** As a user, I want the app to detect when Jobber session cookies have expired, so that I am informed and can take action to restore full request details.

#### Acceptance Criteria

1. WHEN the Client_App receives a form-data response with `"sessionExpired": true`, THE Client_App SHALL display a visual indicator that the Jobber session has expired.
2. THE Client_App SHALL display the session expiration indicator within the request detail view on the QuoteInputPage.
3. WHEN the session is expired, THE Client_App SHALL still display any fallback form data (from notes/description) that was returned in the response.

### Requirement 6: Client-Side Re-Authentication Flow

**User Story:** As a user, I want a simple way to re-authenticate with Jobber when cookies expire, so that I can restore access to full request details with minimal friction.

#### Acceptance Criteria

1. WHEN the session expiration indicator is displayed, THE Re_Auth_UI SHALL present a "Reconnect Jobber Session" button to the user.
2. WHEN the user taps the "Reconnect Jobber Session" button, THE Re_Auth_UI SHALL open the existing `/api/jobber-auth/set-cookies` page in a new browser tab or a modal/popup window.
3. WHEN the user completes the cookie submission on the set-cookies page, THE Client_App SHALL re-check the session status by calling the Session_Status_Endpoint.
4. WHEN the Session_Status_Endpoint returns `"expired": false` after re-authentication, THE Client_App SHALL automatically retry fetching the form data for the currently selected request.
5. WHEN form data is successfully fetched after re-authentication, THE Client_App SHALL dismiss the session expiration indicator and display the full request details.
6. IF the user closes the re-authentication window without completing the process, THEN THE Client_App SHALL keep the session expiration indicator visible and continue displaying the fallback data.

### Requirement 7: GitHub Actions Secrets Configuration

**User Story:** As a developer, I want clear documentation on the required GitHub Actions secrets, so that the Cookie_Refresh_Workflow can be set up correctly.

#### Acceptance Criteria

1. THE Cookie_Refresh_Workflow SHALL require the following GitHub Actions secrets: `JOBBER_WEB_EMAIL`, `JOBBER_WEB_PASSWORD`, and `CLOUDFLARE_API_TOKEN`.
2. IF any required secret is missing, THEN THE Cookie_Refresh_Workflow SHALL fail with a clear error message identifying the missing secret.
3. THE Cookie_Refresh_Workflow SHALL reference the existing `CLOUDFLARE_API_TOKEN` secret already configured for the deploy workflow.

### Requirement 8: Local Development Cookie Sync Preservation

**User Story:** As a developer, I want the existing local development cookie sync behavior to continue working, so that `npm run dev` still automatically provides valid cookies.

#### Acceptance Criteria

1. WHEN `npm run dev:worker` is executed, THE Sync_Script SHALL check for valid cookies in local D1 first, then attempt to sync from production D1, and only perform a Puppeteer login as a last resort.
2. THE Sync_Script SHALL maintain backward compatibility with the existing `npm run dev` startup flow.
3. WHEN the Sync_Script is invoked without a `--target` argument, THE Sync_Script SHALL default to `--target both` to preserve the current behavior of writing to both local and production D1.
