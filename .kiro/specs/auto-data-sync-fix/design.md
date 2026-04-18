# Auto Data Sync Fix — Bugfix Design

## Overview

The application has three related data loading and synchronization failures that force users into manual workarounds to see their data. Jobber request details require a developer-only backfill call, the Rules page silently swallows fetch errors and shows a misleading empty state, and Instagram posts only sync when visiting the Quick Post page — not the Dashboard where users land first.

The fix introduces a cohesive automatic data refresh strategy: the Dashboard triggers Instagram sync in the background, the Rules page surfaces errors with retry capability, and Jobber request data is fetched on-demand from the public API when local data is missing — eliminating the need for manual backfill. All changes are additive and preserve existing fallback chains, webhook processing, and cooldown mechanisms.

## Bug Details

### Bug Condition

The bug manifests across three independent but related scenarios where data loading either silently fails or requires manual intervention that is not exposed in the UI.

**Scenario A — Jobber Request Details**: When a user selects a Jobber request in the quote input page and no data exists in `jobber_webhook_requests` for that request, the form-data endpoint (`GET /api/quotes/jobber/requests/:id/form-data` in `server/src/routes/quotes.ts`) already attempts the public API fallback. However, when the `jobber_webhook_requests` table is entirely empty (no webhooks received), the request *list* endpoint (`GET /jobber/requests`) returns incomplete data with no mechanism to populate missing details automatically. The only way to populate the table is via `POST /jobber/backfill`, which is not exposed in the UI.

**Scenario B — Rules Silent Failure**: When `fetchRules()` fails on the Rules page, the `catch` block in `RulesPage.tsx` silently swallows the error, calls `setLoading(false)`, and renders an empty state — making it appear as if no rules exist rather than communicating a failure.

**Scenario C — Instagram Sync Only on Quick Post**: `DashboardPage.tsx` calls `fetchPosts()` but never triggers an Instagram sync. The sync is only triggered via the `POST /posts/quick-start` endpoint (fire-and-forget), which is only called when visiting the Quick Post page. Users who check the Dashboard first never see recently published Instagram posts.

### Examples

- **Scenario A**: User opens the quote input page for the first time. The `jobber_webhook_requests` table is empty because no webhooks have been received yet. The request list shows titles from the Jobber API but no detailed descriptions, notes, or images. The user must ask a developer to call `POST /jobber/backfill` to populate the data. Expected: details should be fetched automatically from the public API when missing.
- **Scenario B**: User navigates to the Rules page while the database is temporarily unreachable. The page shows "No rule groups found. Create a group to get started." — implying no rules exist. The user has no way to retry or know that an error occurred. Expected: an error message with a retry button should appear.
- **Scenario C**: User publishes an Instagram post externally, then opens the app Dashboard. The post does not appear in the "Recent Posts" list. The user must navigate to Quick Post (triggering `quick-start` and its fire-and-forget sync), then go back to the Dashboard to see the post. Expected: the Dashboard should trigger a background sync so posts appear on first visit.

## Hypothesized Root Cause

1. **Missing Dashboard Sync Trigger (Scenario C)**: `DashboardPage.tsx` calls `fetchPosts()` and `fetchChannels()` but has no call to trigger an Instagram sync. The sync is only wired into the `POST /posts/quick-start` route handler in `server/src/routes/posts.ts`. The Dashboard needs its own sync trigger.

2. **Silent Error Swallowing in RulesPage (Scenario B)**: In `RulesPage.tsx`, the `load` callback's `catch` block is empty (`catch { // handled by global error display }`). While the global `ErrorToast` does fire for API errors, the page itself transitions from loading to an empty state with no local error indication or retry mechanism. The toast auto-dismisses after 8 seconds, leaving the user on a page that looks like it has no rules.

3. **No Automatic Jobber Request Detail Enrichment (Scenario A)**: The `GET /jobber/requests` endpoint in `server/src/routes/quotes.ts` fetches the request list from the Jobber API and merges with webhook data, but does not attempt to fetch and store full details for requests that lack them. The individual `form-data` endpoint does have a public API fallback, but the list endpoint does not proactively populate missing data.

## Preservation Requirements

- The Jobber web session (`JobberWebSession`) must continue to be the primary source for form data, with the public API as a fallback
- Webhook data must continue to be received, processed, and stored as it arrives
- The `POST /jobber/backfill` endpoint must continue to function for manual bulk backfill
- The `POST /posts/quick-start` endpoint must continue to trigger a fire-and-forget Instagram sync
- The Instagram sync cooldown (5-minute in-memory gate) must continue to prevent excessive API calls
- When the Jobber API is unavailable, the system must continue to fall back to locally cached data
- Quote generation, revision, draft management, and all quote engine behavior must remain identical
- When rules are successfully fetched, the Rules page must render identically

## Correctness Properties

**Property 1: Dashboard Triggers Instagram Sync**
_For any_ authenticated user visiting the Dashboard page, the system SHALL trigger a background Instagram post sync (respecting the existing 5-minute cooldown), so that recently published Instagram posts appear without requiring navigation to the Quick Post page.

**Property 2: Rules Page Shows Error With Retry**
_For any_ Rules page load where `fetchRules()` fails, the page SHALL display a visible error message and a retry button, rather than an empty state.

**Property 3: Jobber Request Details Auto-Fetched**
_For any_ Jobber request list load where requests lack detailed data in `jobber_webhook_requests`, the system SHALL automatically attempt to fetch and store details from the Jobber public API in the background.

**Property 4: Preservation**
_For any_ input where the bug condition does NOT hold, the fixed code SHALL produce exactly the same behavior as the original code.

## Fix Implementation

See `tasks.md` for detailed implementation steps. Summary of changes:

1. **`client/src/pages/DashboardPage.tsx`** — Import `syncInstagramPosts` from `../api` and call it fire-and-forget in the existing `useEffect`. The `syncInstagramPosts` function and `POST /api/channels/instagram/sync` endpoint already exist.

2. **`client/src/pages/RulesPage.tsx`** — Add `loadError` state, set it in the `catch` block, render an error banner with retry button when `loadError` is set and `groups` is empty.

3. **`server/src/routes/quotes.ts`** — In the `GET /jobber/requests` handler, after the webhook merge, fire-and-forget enrichment calls for up to 5 incomplete requests (missing description, notes, or images). Non-blocking, individually wrapped in try/catch.

## Testing Strategy

Two-phase approach: write tests BEFORE the fix, then verify after.

**Phase 1 — Bug condition tests** (should FAIL on unfixed code, PASS after fix): Verify that DashboardPage calls `syncInstagramPosts` on mount, RulesPage shows error + retry on fetch failure, and the Jobber request list handler triggers background enrichment for incomplete requests.

**Phase 2 — Preservation tests** (should PASS on both unfixed and fixed code): Verify that successful rule fetches render identically, Quick Post sync trigger is unchanged, Instagram sync cooldown works, Jobber API fallback to cached data works, and webhook merge behavior is unchanged.

Use fast-check for property-based testing where applicable — generating random rule group configurations, request lists with varying completeness, API error types, and cooldown states.
