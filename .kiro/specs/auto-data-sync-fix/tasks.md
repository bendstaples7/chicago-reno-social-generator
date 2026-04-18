# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - Write these tests BEFORE the fix. They should FAIL on unfixed code (confirming the bugs exist) and PASS after the fix.
  - Create test file `tests/property/auto-data-sync-bug-condition.property.test.ts`
  - **Scenario C — Dashboard Instagram Sync**: Mock `syncInstagramPosts` from `client/src/api.ts`. Render `DashboardPage` and assert that `syncInstagramPosts` is called during mount (fire-and-forget). On unfixed code this will FAIL because `DashboardPage.tsx` never calls `syncInstagramPosts`.
  - **Scenario B — Rules Page Error Handling**: Mock `fetchRules` to reject with a network error. Render `RulesPage` and assert that an error message is visible AND a retry button is rendered. On unfixed code this will FAIL because the catch block silently swallows the error and shows an empty state.
  - **Scenario A — Jobber Request Auto-Enrichment**: Mock the `GET /jobber/requests` handler logic. Given a merged request list where some requests lack detailed data (empty description, no notes, no images), assert that background `fetchRequestDetail` calls are triggered for incomplete requests. On unfixed code this will FAIL because no enrichment logic exists in the handler.
  - **Scoped PBT Approach**: Use fast-check to generate arbitrary API error types for Scenario B (network errors, 500s, timeouts) and verify error UI always appears. For Scenario A, generate request lists with varying completeness and verify enrichment is triggered for incomplete entries.
  - Run tests on UNFIXED code — expected outcome: tests FAIL (proves bugs exist)
  - Document counterexamples found to understand root cause
  - _Requirements: 1.1–1.5, 2.1–2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - Write these tests on UNFIXED code first. They should PASS on both unfixed and fixed code.
  - Create test file `tests/property/auto-data-sync-preservation.property.test.ts`
  - **Rules Success Preservation**: For all valid `RuleGroupWithRules[]` arrays, the page renders group names, rule names, descriptions, and active/inactive badges identically.
  - **Quick Post Sync Preservation**: For all quick-start calls, `InstagramSyncService.syncRecentPosts` is triggered exactly once.
  - **Sync Cooldown Preservation**: For all calls within the 5-minute cooldown, the result is the no-op result and no Instagram API call is made.
  - **Jobber Fallback Preservation**: For all unavailable-API states, cached/imported data is returned rather than an empty array (when DB has data).
  - **Webhook Merge Preservation**: For all combinations of API requests and webhook requests, the merge logic produces a superset sorted by date descending.
  - Use fast-check to generate random rule group configurations, request lists, and cooldown states
  - Run tests on UNFIXED code — expected outcome: tests PASS (confirms baseline behavior)
  - _Requirements: 3.1–3.8_

- [x] 3. Fix for auto data sync silent failures

  - [x] 3.1 Add Instagram sync trigger to DashboardPage
    - In `client/src/pages/DashboardPage.tsx`, import `syncInstagramPosts` from `../api`
    - In the existing `useEffect`, add a fire-and-forget call: `syncInstagramPosts().catch(() => {})` alongside the existing `fetchPosts` and `fetchChannels` calls
    - The sync call must be non-blocking — Dashboard rendering must not depend on its result
    - The existing 5-minute in-memory cooldown in `InstagramSyncService` will prevent excessive API calls
    - _Requirements: 1.5, 2.3, 3.5, 3.6_

  - [x] 3.2 Add error state with retry to RulesPage
    - In `client/src/pages/RulesPage.tsx`, add a `loadError` state variable (`string | null`, initially `null`)
    - In the `load` callback, clear `loadError` at the start (`setLoadError(null)`)
    - In the `catch` block, set `loadError` to a user-friendly message: `"Failed to load rules. Please try again."`
    - When `loadError` is set and `groups` is empty, render an error banner (red/orange background) with the error message and a "Retry" button that calls `load()` again
    - On successful retry, `loadError` is cleared (already handled by clearing at start of `load`)
    - _Requirements: 1.4, 2.2, 3.4_

  - [x] 3.3 Add background auto-enrichment for incomplete Jobber requests
    - In `server/src/routes/quotes.ts`, in the `GET /jobber/requests` handler, after the webhook merge and re-sort, identify requests that lack detailed data (empty or missing `description`, no `notes`/`structuredNotes`, no `imageUrls`)
    - For up to 5 incomplete requests, fire-and-forget calls to `jobberIntegration.fetchRequestDetail(requestId)` to fetch full details from the Jobber public API
    - Store fetched details in the `jobber_webhook_requests` table (reuse the existing insert/upsert pattern from the `GET /jobber/requests/:id` handler)
    - The enrichment is non-blocking — the response returns immediately with whatever data is currently available
    - Wrap each enrichment call in a try/catch so individual failures don't affect others
    - Log enrichment activity for debugging but don't surface errors to the client
    - _Requirements: 1.1–1.3, 2.1, 3.1–3.3, 3.7_

- [x] 4. Checkpoint — Verify all tests pass
  - Run `npm test` to execute the full test suite
  - Re-run bug condition tests from task 1 — expected outcome: PASS (confirms bugs are fixed)
  - Re-run preservation tests from task 2 — expected outcome: PASS (confirms no regressions)
  - Verify all existing unit tests still pass
  - Ask the user if questions arise
