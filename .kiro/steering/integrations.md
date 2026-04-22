---
description: External API integrations and their constraints
category: Integrations
---

# External Integrations

## OpenAI API
- Text generation for content and quotes
- Embeddings for similarity search

## Instagram Graph API
- Post publishing and account management

## Jobber GraphQL API
- Customer requests, products, quotes, webhooks
- ⚠️ The public API does NOT expose `requestDetails.form` (customer form submissions). This data is only available via Jobber's internal API using web session cookies. See `JobberWebSession` service and `JobberCookieRefresher` (uses Cloudflare Browser Rendering for automated cookie refresh). Do not remove these without confirming Jobber has added form data to their public API.
