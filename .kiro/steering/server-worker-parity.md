---
inclusion: auto
---

# Server ↔ Worker Parity Rule

This project has **two API implementations** that must stay in sync:

- `server/` — Express + PostgreSQL (local development)
- `worker/` — Hono + Cloudflare D1 (production deployment)

## Critical Rule

**Every business logic change made to a service or route in `server/src/` MUST also be applied to the corresponding file in `worker/src/`, and vice versa.**

The files mirror each other with platform-specific differences:
- **Database**: Server uses `pg` with `$1` parameter placeholders. Worker uses D1 with `?` placeholders.
- **Storage**: Server uses AWS S3. Worker uses Cloudflare R2.
- **Crypto**: Server uses Node.js `crypto`. Worker uses Web Crypto API.
- **Framework**: Server uses Express (`req`, `res`). Worker uses Hono (`c`).

## Mirrored File Pairs

### Services (`server/src/services/` ↔ `worker/src/services/`)
| Server | Worker |
|--------|--------|
| activity-log-service.ts | activity-log-service.ts |
| auth-service.ts | auth-service.ts |
| content-advisor.ts | content-advisor.ts |
| content-generator.ts | content-generator.ts |
| content-ideas-service.ts | content-ideas-service.ts |
| content-templates.ts | content-templates.ts |
| cross-poster.ts | cross-poster.ts |
| embedding-service.ts | embedding-service.ts |
| image-generator.ts | image-generator.ts |
| instagram-channel.ts | instagram-channel.ts |
| instagram-sync-service.ts | instagram-sync-service.ts |
| jobber-integration.ts | jobber-integration.ts |
| jobber-token-store.ts | jobber-token-store.ts |
| jobber-webhook-service.ts | jobber-webhook-service.ts |
| media-service.ts | media-service.ts |
| post-service.ts | post-service.ts |
| publish-approval-service.ts | publish-approval-service.ts |
| quote-draft-service.ts | quote-draft-service.ts |
| quote-engine.ts | quote-engine.ts |
| quote-sync-service.ts | quote-sync-service.ts |
| revision-engine.ts | revision-engine.ts |
| rules-service.ts | rules-service.ts |
| similarity-engine.ts | similarity-engine.ts |
| user-settings-service.ts | user-settings-service.ts |

### Routes (`server/src/routes/` ↔ `worker/src/routes/`)
| Server | Worker |
|--------|--------|
| activity-log.ts | activity-log.ts |
| auth.ts | auth.ts |
| channels.ts | channels.ts |
| content-ideas.ts | content-ideas.ts |
| content.ts | content.ts |
| media.ts | media.ts |
| posts.ts | posts.ts |
| quotes.ts | quotes.ts |
| settings.ts | settings.ts |
| webhooks.ts | webhooks.ts |

## Workflow

When modifying any file listed above:
1. Make the change in the file being edited
2. Immediately apply the equivalent change to the counterpart file
3. Adapt platform-specific syntax (pg → D1, Express → Hono, etc.)
4. Verify both server and worker build successfully

## SQL Differences Cheat Sheet

| Concept | Server (PostgreSQL) | Worker (D1/SQLite) |
|---------|--------------------|--------------------|
| Parameters | `$1, $2, $3` | `?, ?, ?` |
| Upsert | `ON CONFLICT ... DO UPDATE SET col = EXCLUDED.col` | `ON CONFLICT ... DO UPDATE SET col = excluded.col` |
| Timestamp | `NOW()` | `datetime('now')` |
| DISTINCT ON | `DISTINCT ON (col)` | Use `GROUP BY` + subquery |
| JSON | Native JSONB | Text column with `JSON()` |

## Agent Hook

A Kiro agent hook (`server-worker-parity-check`) is configured in `.kiro/hooks/` to automatically remind the agent to apply changes to both sides whenever a mirrored file is edited. Since `.kiro/hooks/` is gitignored, each developer should create this hook locally via the Kiro Hook UI or command palette.
