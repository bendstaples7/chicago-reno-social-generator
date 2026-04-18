# Implementation Plan: Jobber Session Automation

## Overview

This plan implements automated Jobber web session cookie lifecycle management across three layers: a GitHub Actions scheduled workflow for automated refresh, enhanced API signaling for cookie state, and a client-side re-authentication UI as a fallback. Tasks are ordered to build the backend foundation first, then wire up the client, and finish with the CI automation.

## Tasks

- [x] 1. Enhance the session status endpoint and JobberWebSession service
  - [x] 1.1 Add `getStatus()` method to `JobberWebSession` in `worker/src/services/jobber-web-session.ts`
    - Add a new `getStatus()` method that queries `jobber_web_session` for the `expires_at` column
    - Return `{ configured: false, expired: false }` when no row exists
    - Return `{ configured: true, expired: true }` when `expires_at` is in the past
    - Return `{ configured: true, expired: false }` when `expires_at` is in the future
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 1.2 Write property test: Cookie status reflects expiration correctly
    - **Property 1: Cookie status reflects expiration correctly**
    - Generate random `expires_at` timestamps (past, future, edge cases) and verify `getStatus()` returns the correct `configured`/`expired` values
    - Test the no-row case returns `{ configured: false, expired: false }`
    - Add to `tests/property/jobber-session-automation.property.test.ts`
    - **Validates: Requirements 3.2, 3.3**

  - [x] 1.3 Update the session-cookies status route in `worker/src/routes/jobber-auth.ts`
    - Replace the existing `GET /session-cookies/status` handler that returns `{ configured }` with one that calls `getStatus()` and returns `{ configured, expired }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 1.4 Write unit tests for the session status endpoint
    - Test all three states: no cookies, expired cookies, valid cookies
    - Use the mock D1 helper from `tests/unit/helpers/mock-d1.ts`
    - Add to `tests/unit/jobber-session-automation.test.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 2. Add sessionExpired signaling to the form-data endpoint
  - [x] 2.1 Modify `fetchRequestFormData` in `worker/src/services/jobber-web-session.ts` to return `{ formData, sessionExpired }`
    - Change the return type from `RequestFormData | null` to `{ formData: RequestFormData | null; sessionExpired: boolean }`
    - Return `sessionExpired: true` when cookies are null/expired or when `queryInternalApi` returns `authFailed: true`
    - Return `sessionExpired: false` when cookies are valid and the API call succeeds (or fails with a non-auth error)
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.2 Update the form-data route handler in `worker/src/routes/quotes.ts`
    - Modify `GET /jobber/requests/:id/form-data` to destructure `{ formData, sessionExpired }` from the service call
    - Include `sessionExpired` in the JSON response alongside `formData`
    - When the web session fetch is skipped (no cookies), set `sessionExpired: true` in the fallback response
    - When the internal API returns auth failure, set `sessionExpired: true` in the fallback response
    - When the internal API returns a non-auth error or times out, set `sessionExpired: false` in the fallback response
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 2.3 Write property test: Form-data sessionExpired reflects cookie validity
    - **Property 2: Form-data sessionExpired reflects cookie validity**
    - Generate random cookie states (valid, expired, missing) and mock internal API responses (success, 401, 403, other error)
    - Verify `sessionExpired` is correctly set for every combination
    - Add to `tests/property/jobber-session-automation.property.test.ts`
    - **Validates: Requirements 4.1, 4.2**

  - [ ]* 2.4 Write property test: Auth error classification as session expired
    - **Property 3: Auth error classification as session expired**
    - Generate random HTTP status codes and GraphQL error messages
    - Verify that exactly 401, 403, and messages containing "unauthenticated" or "hidden" trigger `authFailed: true`
    - Add to `tests/property/jobber-session-automation.property.test.ts`
    - **Validates: Requirements 4.3**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update client API layer and add SessionExpiredBanner component
  - [x] 4.1 Update `fetchJobberRequestFormData` in `client/src/api.ts` to include `sessionExpired` in the return type
    - Change the return type to `Promise<{ formData: JobberRequestFormData | null; sessionExpired: boolean }>`
    - _Requirements: 5.1_

  - [x] 4.2 Add `checkJobberSessionStatus` function to `client/src/api.ts`
    - Add a new function that calls `GET /api/jobber-auth/session-cookies/status` and returns `{ configured: boolean; expired: boolean }`
    - _Requirements: 6.3_

  - [x] 4.3 Create `SessionExpiredBanner` component at `client/src/pages/SessionExpiredBanner.tsx`
    - Accept `onReconnected: () => void` prop
    - Render an amber/warning banner with text: "⚠️ Jobber session expired. Request details may be incomplete."
    - Show a teal "Reconnect Jobber Session" button
    - On button click: open `/api/jobber-auth/set-cookies` in a new tab via `window.open`
    - Start polling `checkJobberSessionStatus` every 3 seconds after the button is clicked
    - When status returns `expired: false`, call `onReconnected()` and dismiss the banner
    - Stop polling after 5 minutes or on component unmount (cleanup with `useEffect`)
    - Use the existing app color scheme (`#00a89d` teal, `#fff3e0` amber background)
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 4.4 Write unit tests for SessionExpiredBanner
    - Test that the banner renders when mounted
    - Test that clicking "Reconnect Jobber Session" opens the set-cookies page
    - Test that the banner dismisses after `onReconnected` is called when polling returns `expired: false`
    - Test that the banner persists when the re-auth window is closed without completing
    - Add to `tests/unit/jobber-session-automation.test.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 5. Integrate session expiration into QuoteInputPage and RequestSelector
  - [x] 5.1 Add `sessionExpired` state tracking to `QuoteInputPage` in `client/src/pages/QuoteInputPage.tsx`
    - Add `sessionExpired` state variable, initialized to `false`
    - Update `handleRequestSelect` to destructure `sessionExpired` from `fetchJobberRequestFormData` response and set state
    - Pass `sessionExpired` down to `RequestSelector` as a new prop
    - Add `handleReconnected` callback that re-fetches form data for the currently selected request and resets `sessionExpired` to `false`
    - Pass `onReconnected={handleReconnected}` to `RequestSelector`
    - _Requirements: 5.1, 5.2, 5.3, 6.4, 6.5_

  - [x] 5.2 Update `RequestSelector` in `client/src/pages/RequestSelector.tsx` to show `SessionExpiredBanner`
    - Add `sessionExpired` and `onReconnected` props to the component interface
    - When `sessionExpired` is true and a request is selected, render `SessionExpiredBanner` inside the detail card
    - Position the banner after the form data section (or in place of the "form details not available" message when appropriate)
    - Continue displaying any fallback form data alongside the banner
    - _Requirements: 5.1, 5.2, 5.3, 6.1_

  - [ ]* 5.3 Write unit tests for QuoteInputPage session expiration integration
    - Test that `sessionExpired: true` from the API triggers the banner in RequestSelector
    - Test that successful re-auth retries form data fetch and dismisses the banner
    - Add to `tests/unit/jobber-session-automation.test.ts`
    - _Requirements: 5.1, 5.2, 5.3, 6.4, 6.5_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Refactor sync-cookies.mjs to support --target flag
  - [x] 7.1 Add `--target` argument parsing to `worker/scripts/sync-cookies.mjs`
    - Parse `--target local|remote|both` from `process.argv`, defaulting to `both`
    - Extract credential reading to check `.dev.vars` first, then fall back to `process.env.JOBBER_WEB_EMAIL` and `process.env.JOBBER_WEB_PASSWORD`
    - _Requirements: 2.1, 2.5_

  - [x] 7.2 Implement target-aware cookie checking and writing in `worker/scripts/sync-cookies.mjs`
    - When `--target remote`: check remote D1 only → if expired, login → validate → write to remote D1 only
    - When `--target local`: check local D1 → if expired, try sync from remote → if still expired, login → validate → write to local D1 only
    - When `--target both` (default): check local D1 → if expired, try sync from remote → if still expired, login → validate → write to both
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 8.1, 8.3_

  - [x] 7.3 Add proper exit codes and error handling to `worker/scripts/sync-cookies.mjs`
    - Exit with code 0 on success (cookies refreshed or already valid)
    - Exit with code 1 on failure (login failed, validation failed, timeout, missing credentials in CI)
    - Replace the current swallowed-error pattern with `process.exit(1)` on failure
    - Add `headless: 'new'` mode and a realistic desktop user agent string to the Puppeteer launch
    - _Requirements: 2.6, 1.7, 1.8, 1.9, 1.10_

  - [ ]* 7.4 Write unit tests for sync-cookies.mjs argument parsing and credential resolution
    - Test `parseTarget` returns correct target for `--target local`, `--target remote`, `--target both`, and no argument (default `both`)
    - Test credential reading falls back to env vars when `.dev.vars` is not available
    - Add to `tests/unit/jobber-session-automation.test.ts`
    - _Requirements: 2.1, 2.5, 8.2, 8.3_

- [x] 8. Create GitHub Actions workflow for scheduled cookie refresh
  - [x] 8.1 Create `.github/workflows/refresh-jobber-cookies.yml`
    - Add `schedule` trigger with cron `0 */3 * * *` (every 3 hours)
    - Add `workflow_dispatch` trigger for manual execution
    - Steps: checkout, setup Node.js 20, `npm ci`, install Chromium (`npx puppeteer browsers install chrome`), run `node worker/scripts/sync-cookies.mjs --target remote`
    - Pass `JOBBER_WEB_EMAIL`, `JOBBER_WEB_PASSWORD`, and `CLOUDFLARE_API_TOKEN` from GitHub secrets as environment variables
    - Set working directory to `worker` for the sync-cookies step
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.10, 7.1, 7.2, 7.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The sync-cookies.mjs refactor (task 7) preserves backward compatibility with `npm run dev` by defaulting to `--target both`
- GitHub secrets `JOBBER_WEB_EMAIL` and `JOBBER_WEB_PASSWORD` must be configured manually in the repository settings before the workflow will succeed
