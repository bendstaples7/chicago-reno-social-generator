# Implementation Plan: Jobber Auth on Login

## Overview

This plan implements a unified systems check at app startup, flips the error toast default (no toast → opt-in toast), removes the Jobber web session cookie system entirely, simplifies the form-data fallback chain to server-side only, adds background enrichment of incomplete Jobber requests, and changes the OAuth callback to redirect instead of rendering HTML. All changes target the existing Cloudflare Worker (Hono) + React client architecture.

## Tasks

- [x] 1. Flip `handleResponse` default and add `handleResponseWithToast` in client API layer
  - [x] 1.1 Modify `handleResponse` in `client/src/api.ts` to NOT call `globalErrorListener` on error — it should only parse the error body and throw
    - Remove the `globalErrorListener?.(error)` call from `handleResponse`
    - _Requirements: 8.1, 6.1, 6.2_
  - [x] 1.2 Add `handleResponseWithToast` function in `client/src/api.ts` that parses error body, calls `globalErrorListener`, and throws
    - Same logic as old `handleResponse` but explicitly calls `globalErrorListener?.(error)` before throwing
    - _Requirements: 8.1_
  - [x] 1.3 Update all user-initiated action API functions to use `handleResponseWithToast` instead of `handleResponse`
    - Functions to update: `login`, `uploadMedia`, `generateImages` (including inline `globalErrorListener` calls), `saveGeneratedImage`, `deleteMedia`, `createPost`, `updatePost`, `generateContent`, `approvePost`, `publishPost`, `quickStart`, `updateSettings`, `connectInstagram`, `disconnectChannel`, `refreshInstagramToken`, `generateQuote`, `reviseDraft`, `saveCatalog`, `saveTemplates`, `generateContentIdeas`, `createRule`, `updateRule`, `deactivateRule`, `createRuleGroup`, `updateRuleGroup`, `deleteRuleGroup`, `syncCorpus`
    - Data-loading functions stay on `handleResponse` (no toast): `verifySession`, `logout`, `fetchPosts`, `fetchPost`, `fetchChannels`, `fetchContentTypes`, `fetchSettings`, `fetchActivityLog`, `fetchDrafts`, `fetchDraft`, `deleteDraft`, `updateDraft`, `fetchCatalog`, `fetchTemplates`, `checkJobberStatus`, `fetchJobberRequests`, `fetchJobberRequestFormData`, `fetchCorpusStatus`, `syncInstagramPosts`, `fetchAdvisorSuggestion`, `fetchContentIdeas`, `useContentIdea`, `dismissContentIdea`, `fetchRules`, `listMedia`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 6.1_
  - [ ]* 1.4 Write property test for `handleResponse` vs `handleResponseWithToast` toast behavior
    - **Property 3: handleResponse default suppresses toast, handleResponseWithToast fires toast**
    - Generate random HTTP error responses (status 400-599, structured `ErrorResponse` bodies and plain `{ error: string }` bodies), verify `handleResponse` never calls `globalErrorListener` and `handleResponseWithToast` always calls it exactly once
    - Test file: `tests/property/handle-response-toast.property.test.ts`
    - **Validates: Requirements 6.1, 8.1**

- [x] 2. Add `SystemsStatusResponse` type and `GET /api/systems/status` endpoint
  - [x] 2.1 Add `SystemsStatusResponse` interface to `shared/src/types/common.ts`
    - Define `SystemsStatusResponse` with `jobber: { available: boolean }` and `instagram: { status: 'connected' | 'expired' | 'not_connected'; accountName?: string }`
    - Export from `shared/src/types/index.ts`
    - _Requirements: 1.5_
  - [x] 2.2 Create `worker/src/routes/systems.ts` with `GET /` endpoint
    - Import `sessionMiddleware`, `JobberTokenStore`, and query `channel_connections` for Instagram status
    - Check `jobber_token_store` for valid tokens (reuse `JobberTokenStore.load()` logic)
    - Query `channel_connections` for Instagram channel status (connected/expired/not_connected) and account name
    - Return `SystemsStatusResponse` JSON
    - On D1 errors: return `jobber.available: false` (fail-closed) and `instagram.status: 'not_connected'` (fail-open)
    - _Requirements: 1.5_
  - [x] 2.3 Register the systems route in `worker/src/index.ts`
    - Import `systemsRoutes` from `./routes/systems.js`
    - Add `app.route('/api/systems', systemsRoutes)`
    - _Requirements: 1.5_
  - [ ]* 2.4 Write property test for systems status aggregation logic
    - **Property 1: Systems status aggregation is consistent**
    - Generate random combinations of Jobber token state (present/absent) and Instagram channel state (connected/expired/no row), verify response correctness
    - Test file: `tests/property/systems-status-aggregation.property.test.ts`
    - **Validates: Requirements 1.5**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend `AuthContext` with systems check and add `fetchSystemsStatus` API function
  - [x] 4.1 Add `fetchSystemsStatus` function to `client/src/api.ts`
    - `GET /api/systems/status` with `authHeaders()`, uses `handleResponse` (no toast)
    - Remove `checkJobberSessionStatus` export entirely
    - _Requirements: 1.1, 1.2, 4.2_
  - [x] 4.2 Extend `AuthContext.tsx` with `systemsStatus`, `recheckSystems`, and `skipInstagram`
    - Add `SystemsStatus` type: `'idle' | 'checking' | 'ready' | 'jobber_unavailable' | 'instagram_issue' | 'error'`
    - After `verifySession` succeeds, call `fetchSystemsStatus()` and set `systemsStatus` accordingly
    - `recheckSystems()` re-calls the endpoint (used after OAuth return)
    - `skipInstagram()` sets status to `'ready'`
    - Detect `?oauth_error=...` query parameter on load and set error state
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 5.2, 5.4_
  - [ ]* 4.3 Write property test for critical vs non-critical gate logic
    - **Property 2: Critical vs non-critical gate logic**
    - Generate random `SystemsStatusResponse` objects with all combinations of `jobber.available` and `instagram.status`, verify the "can proceed to ready" logic returns `true` iff `jobber.available === true`
    - Test file: `tests/property/systems-check-gate-logic.property.test.ts`
    - **Validates: Requirements 1.4, 2.5**

- [x] 5. Update `Layout.tsx` to render systems check prompts
  - [x] 5.1 Modify `Layout.tsx` to read `systemsStatus` from `useAuth()` and conditionally render
    - `checking`: loading spinner overlay
    - `jobber_unavailable`: full-page Jobber OAuth prompt with "Connect Jobber" button linking to `GET /api/jobber-auth/authorize`
    - `instagram_issue`: dismissible warning banner at top with link to Settings and "Skip" button (calls `skipInstagram()`)
    - `error`: error message with retry button (calls `recheckSystems()`)
    - `ready`: normal Layout with sidebar + Outlet (existing behavior)
    - _Requirements: 1.3, 1.4, 1.6, 2.1, 2.2, 2.5_

- [x] 6. Modify OAuth callback to redirect instead of HTML page
  - [x] 6.1 Update `GET /callback` in `worker/src/routes/jobber-auth.ts` to redirect on success
    - On successful token exchange: `return c.redirect(origin + '/social/dashboard')` instead of returning HTML
    - On failure: `return c.redirect(origin + '/social/dashboard?oauth_error=' + encodeURIComponent(errorMsg))` instead of returning JSON error
    - Handle missing code: redirect with `?oauth_error=Missing+authorization+code`
    - Handle missing credentials: redirect with `?oauth_error=Server+configuration+error`
    - _Requirements: 5.1, 5.3_

- [x] 7. Remove web session cookie system
  - [x] 7.1 Remove `set-cookies` and `session-cookies/status` endpoints from `worker/src/routes/jobber-auth.ts`
    - Delete `POST /set-cookies`, `GET /set-cookies`, and `GET /session-cookies/status` route handlers
    - Remove `JobberWebSession` import from this file
    - _Requirements: 4.1, 4.2_
  - [x] 7.2 Delete `worker/src/services/jobber-web-session.ts`
    - Remove the entire file
    - Remove from `worker/src/services/index.ts` barrel export if present
    - _Requirements: 4.1_
  - [x] 7.3 Delete `worker/scripts/sync-cookies.mjs`
    - Remove the Puppeteer cookie sync script
    - _Requirements: 4.1_

- [x] 8. Simplify form-data endpoint to server-side-only fallback chain
  - [x] 8.1 Rewrite `GET /jobber/requests/:id/form-data` in `worker/src/routes/quotes.ts`
    - Remove `JobberWebSession` import and all web session cookie logic
    - New fallback chain (all server-side): D1 `jobber_webhook_requests` → Jobber public GraphQL API fetch + store → return null
    - Response shape: `{ formData: JobberRequestFormData | null }` — no `sessionExpired` field
    - _Requirements: 4.1, 4.3_

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Add background enrichment to `GET /jobber/requests` in worker
  - [x] 10.1 Add enrichment logic to `GET /jobber/requests` handler in `worker/src/routes/quotes.ts`
    - After building the response, identify incomplete requests (empty description AND zero structuredNotes AND zero imageUrls)
    - Select up to 5 incomplete requests
    - Use `c.executionCtx.waitUntil()` to fire-and-forget enrichment calls
    - Each enrichment call fetches full details from Jobber public GraphQL API and upserts into `jobber_webhook_requests` using existing pattern
    - Each call individually wrapped in try/catch — failures logged to console, do not affect response or other calls
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [ ]* 10.2 Write property test for enrichment target selection logic
    - **Property 4: Enrichment target selection respects completeness and cap**
    - Extract the enrichment selection logic into a pure function, generate random arrays of request objects (0-100 items, varying completeness), verify returns `min(incomplete, 5)` items and all are truly incomplete
    - Test file: `tests/property/enrichment-target-selection.property.test.ts`
    - **Validates: Requirements 7.1, 7.2**

- [x] 11. Clean up client components — remove session banner and session state
  - [x] 11.1 Delete `client/src/pages/SessionExpiredBanner.tsx`
    - Remove the entire file
    - _Requirements: 3.4_
  - [x] 11.2 Remove session-related props from `RequestSelector.tsx`
    - Remove `sessionExpired` and `onReconnected` from `RequestSelectorProps` interface
    - Remove `SessionExpiredBanner` import
    - Remove all rendering of `SessionExpiredBanner`
    - _Requirements: 3.1, 3.3_
  - [x] 11.3 Simplify `QuoteInputPage.tsx` — remove session state and simplify form data handling
    - Remove `sessionExpired` state variable and all `setSessionExpired` calls
    - Remove `handleReconnected` callback
    - Remove `sessionExpired` and `onReconnected` props passed to `RequestSelector`
    - Simplify `handleRequestSelect`: call `fetchJobberRequestFormData(request.id)`, use data if returned, fall back to title + description + notes if null — no `sessionExpired` handling
    - Update `fetchJobberRequestFormData` return type usage to not destructure `sessionExpired`
    - _Requirements: 3.2, 4.1, 4.3_
  - [x] 11.4 Update `fetchJobberRequestFormData` in `client/src/api.ts` to match new response shape
    - Change return type from `{ formData: JobberRequestFormData | null; sessionExpired: boolean }` to `{ formData: JobberRequestFormData | null }`
    - _Requirements: 4.1, 4.3_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The `handleResponse` flip (task 1) is done first because it's the foundation — many subsequent tasks depend on the new toast behavior
- The `jobber_web_session` D1 table is left in place (no migration to drop it) — it becomes unused but harmless
- No changes needed to `DashboardPage.tsx` or `CorpusStatusIndicator.tsx` — the flipped `handleResponse` default in task 1 automatically fixes their toast issues
