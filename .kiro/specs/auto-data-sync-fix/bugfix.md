# Bugfix Requirements Document

## Introduction

The application suffers from three related data loading and synchronization failures that force users to perform manual steps to see their data. Jobber request details don't load without a manual backfill call, saved rules silently fail to load with no retry or error feedback, and Instagram posts only sync when visiting the Quick Post page rather than appearing automatically on the Dashboard. The root cause is a missing cohesive data refresh strategy: no automatic sync on login, no background refresh mechanisms, no error recovery, and manual backfill required for Jobber data.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user selects a Jobber request in the quote input page AND the `jobber_webhook_requests` table has no entry for that request AND the Jobber web session is not configured THEN the `form-data` endpoint attempts to fetch from the Jobber public API but if that also fails, the system returns `{ formData: null }` and the user sees no request details, with no automatic retry or backfill mechanism

1.2 WHEN the `jobber_webhook_requests` table is empty because webhooks have not been received THEN the only way to populate it is by manually calling `POST /jobber/backfill`, which is not exposed in the UI and requires developer intervention

1.3 WHEN the Jobber request list is loaded via `GET /jobber/requests` AND the Jobber API call fails or returns incomplete data AND no webhook data exists THEN the system returns an empty or incomplete request list with no automatic attempt to backfill missing request details

1.4 WHEN a user navigates to the Rules page AND the `fetchRules()` API call fails (network error, server error, timeout) THEN the `catch` block silently swallows the error, `setLoading(false)` is called, and the page displays an empty state with no error message and no retry option, making it appear as if no rules exist

1.5 WHEN a user visits the Dashboard page THEN the system calls `fetchPosts()` to display posts but does not trigger any Instagram sync, so newly published Instagram posts are not visible until the user navigates to the Quick Post page (which triggers `quick-start` and its fire-and-forget sync)

### Expected Behavior (Correct)

2.1 WHEN a user accesses the quotes section AND the `jobber_webhook_requests` table is empty or missing entries for known requests THEN the system SHALL automatically fetch request details from the Jobber public API in the background, store them locally, and display them without requiring any manual backfill step. Loading indicators SHALL be shown for requests whose details are still being retrieved.

2.2 WHEN a user navigates to the Rules page AND the `fetchRules()` API call fails THEN the system SHALL display a clear error message explaining the failure and provide a retry button, rather than showing an empty state that implies no rules exist

2.3 WHEN a user visits the Dashboard page THEN the system SHALL trigger an Instagram post sync in the background (respecting the existing cooldown) so that recently published posts appear without requiring navigation to the Quick Post page

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the Jobber web session is configured and working THEN the system SHALL CONTINUE TO use the internal Jobber web session as the primary source for form data before falling back to the public API

3.2 WHEN webhooks are actively being received from Jobber THEN the system SHALL CONTINUE TO process and store webhook data as it arrives, and SHALL CONTINUE TO merge webhook data with API data when listing requests

3.3 WHEN the `POST /jobber/backfill` endpoint is called manually THEN the system SHALL CONTINUE TO perform the full backfill operation as it does today

3.4 WHEN rules are successfully fetched from the API THEN the system SHALL CONTINUE TO display all rule groups with their nested rules in the current layout and interaction pattern

3.5 WHEN the Quick Post page is visited THEN the system SHALL CONTINUE TO trigger an Instagram sync via the `quick-start` endpoint as it does today

3.6 WHEN the Instagram sync cooldown period has not elapsed THEN the system SHALL CONTINUE TO skip the sync and return immediately, preventing excessive API calls to Instagram

3.7 WHEN the Jobber API is unavailable THEN the system SHALL CONTINUE TO fall back to locally cached data (imported products, cached templates, stored webhook data) rather than blocking the user entirely

3.8 WHEN the server restarts THEN the in-memory Instagram sync cooldown is naturally cleared, allowing a sync on the first relevant page visit. This already works correctly and SHALL CONTINUE TO behave this way.
