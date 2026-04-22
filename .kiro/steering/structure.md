---
description: Directory layout, architecture patterns, and naming conventions
category: Architecture
---

# Project Structure & Conventions

## Directory Layout

```
├── client/                  # React SPA (Vite)
│   └── src/
│       ├── api.ts           # All API calls (single file, fetch-based)
│       ├── App.tsx           # Router and top-level providers
│       ├── AuthContext.tsx    # Auth state via React context
│       ├── ErrorToast.tsx    # Global error toast provider
│       ├── Layout.tsx        # Authenticated shell layout
│       ├── ProtectedRoute.tsx
│       └── pages/            # One component per route
├── worker/                  # Cloudflare Workers API
│   └── src/
│       ├── index.ts          # Hono app + queue consumer export
│       ├── bindings.ts       # CF bindings type definition
│       ├── errors/           # PlatformError class and formatter
│       ├── middleware/        # Hono middleware (error handler, session auth)
│       ├── migrations/       # D1 SQL migrations (numbered)
│       ├── queue/            # Queue consumer (image generation)
│       ├── routes/           # Hono routers (one file per domain)
│       └── services/         # Business logic (one class per domain)
├── shared/                  # Shared TypeScript types
│   └── src/types/            # One file per domain (quote.ts, post.ts, etc.)
├── tests/
│   ├── unit/                # Unit tests (*.test.ts)
│   │   └── helpers/         # Mock implementations (D1, R2, Queue)
│   ├── property/            # Property-based tests (*.property.test.ts)
│   └── integration/         # Integration tests
└── .kiro/specs/             # Feature specs (requirements, design, tasks)
```

## Architecture Patterns

### Error Handling
- All errors use `PlatformError` class with structured fields: `severity`, `component`, `operation`, `description`, `recommendedActions`
- Worker error handler middleware catches errors and formats them as `ErrorResponse` for the client
- Client has a global error listener that shows toast notifications
- Every `PlatformError` must include at least one recommended action

### Service Layer
- Business logic lives in service classes (e.g., `QuoteEngine`, `CrossPoster`, `EmbeddingService`)
- Services are instantiated in routes or middleware, not via DI container
- Services are exported from `worker/src/services/index.ts` barrel file

### API Layer
- All API routes prefixed with `/api/`
- Auth via Bearer token in `Authorization` header
- Session middleware protects routes, attaches user to Hono context
- Client API module (`client/src/api.ts`) is a single file with typed fetch wrappers

### Database
- **Cloudflare D1** (SQLite) — the only database
- Migrations are numbered SQL files in `worker/src/migrations/` (`0001_initial_schema.sql`, `0002_quote_generation.sql`, etc.)
- D1 uses `?` parameter placeholders and `datetime('now')` for timestamps

### Naming Conventions
- Files: kebab-case (`quote-engine.ts`, `activity-log-service.ts`)
- Classes: PascalCase (`QuoteEngine`, `ActivityLogService`)
- Types/Interfaces: PascalCase (`QuoteDraft`, `SimilarQuote`)
- Routes: kebab-case URL segments (`/api/content-ideas`, `/api/activity-log`)
- Migrations: numbered prefix with underscore-separated description (`0007_jobber_token_store.sql`)
- Imports use `.js` extensions (ESM convention)

### Client Routing
- Two top-level sections: `/social/*` (social media) and `/quotes/*` (quote generation)
- Legacy routes redirect to `/social/*` prefixed equivalents
- Pages are flat in `client/src/pages/` (no nested folders)
