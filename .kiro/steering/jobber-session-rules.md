---
description: Critical rules for Jobber session cookie handling and login gating
category: Integrations
---

# Jobber Session Cookie Rules

## Jobber API Limitations (Critical)

The Jobber public GraphQL API is **incomplete**. The following data is NOT available through the public API and requires Jobber web session cookies (internal API access):

- **`requestDetails.form`** — The actual form submission data that customers fill out when submitting a request through Jobber's online booking form. This includes text inputs, multiple-choice answers, date fields, and other structured form data. This is the primary source of customer request details for many requests.

The public API only exposes `notes` and `noteAttachments` on requests. For requests where the customer submitted a form but no team member manually added notes, the public API returns **no content** — even though the form data exists in Jobber's system.

**The `JobberWebSession` service and `JobberCookieRefresher` exist specifically to work around this limitation.** The `JobberCookieRefresher` uses Cloudflare Browser Rendering to automatically log into Jobber and extract session cookies on-demand (during the systems check at login). Do NOT remove this system unless Jobber adds `requestDetails.form` to their public API. Any proposal to simplify the Jobber integration by removing the cookie system must account for this gap — the public API alone is insufficient for the quote generation workflow.

## Jobber Session Cookies Are a BLOCKING Gate

The systems check at login verifies Jobber session cookies are valid. **If cookies are expired or missing, the user MUST be blocked from entering the app.** This is by design — the app is completely unusable without working session cookies because customer request form data cannot be fetched.

- The `jobber_session_expired` state in `AuthContext` MUST render a blocking overlay in `Layout.tsx`, NOT a dismissible banner.
- Do NOT make this check skippable, non-blocking, or optional.
- Do NOT downgrade this to a warning banner based on code review suggestions about "legacy gating" or "non-critical checks."
- The Jobber session check has the same criticality as the Jobber OAuth check — both are hard requirements.
