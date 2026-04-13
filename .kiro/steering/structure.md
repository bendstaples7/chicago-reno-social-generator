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
├── server/                  # Express API (dev/legacy)
│   └── src/
│       ├── index.ts          # Express app setup and route registration
│       ├── env.ts            # dotenv loader
│       ├── config/           # Database and storage config
│       ├── errors/           # PlatformError class and formatter
│       ├── middleware/        # error-handler, session auth
│       ├── migrations/       # Numbered SQL migrations (001_, 002_, ...)
│       ├── routes/           # Express routers (one file per domain)
│       ├── scripts/          # One-off scripts (e.g., import-jobber-products)
│       └── services/         # Business logic (one class per domain)
├── worker/                  # Cloudflare Workers API (production)
│   └── src/
│       ├── index.ts          # Hono app + queue consumer export
│       ├── bindings.ts       # CF bindings type definition
│       ├── errors/           # Same error patterns as server
│       ├── middleware/        # Hono middleware
│       ├── migrations/       # D1 SQL migrations
│       ├── queue/            # Queue consumer (image generation)
│       ├── routes/           # Hono routers (mirrors server routes)
│       └── services/         # Business logic (mirrors server services)
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
- Server middleware catches errors and formats them as `ErrorResponse` for the client
- Client has a global error listener that shows toast notifications
- Every `PlatformError` must include at least one recommended action

### Service Layer
- Business logic lives in service classes (e.g., `QuoteEngine`, `CrossPoster`, `EmbeddingService`)
- Services are instantiated in routes or middleware, not via DI container
- Services are exported from `server/src/services/index.ts` barrel file

### API Layer
- All API routes prefixed with `/api/`
- Auth via Bearer token in `Authorization` header
- Session middleware (`sessionMiddleware`) protects routes, attaches `req.user`
- Client API module (`client/src/api.ts`) is a single file with typed fetch wrappers

### Database
- Server: PostgreSQL via `pg`
- Worker: Cloudflare D1 (SQLite)
- Migrations are numbered SQL files (`001_initial_schema.sql`, `002_content_ideas.sql`, etc.)

### Naming Conventions
- Files: kebab-case (`quote-engine.ts`, `activity-log-service.ts`)
- Classes: PascalCase (`QuoteEngine`, `ActivityLogService`)
- Types/Interfaces: PascalCase (`QuoteDraft`, `SimilarQuote`)
- Routes: kebab-case URL segments (`/api/content-ideas`, `/api/activity-log`)
- Migrations: numbered prefix with underscore-separated description (`007_quote_corpus.sql`)
- Server imports use `.js` extensions (ESM convention)

### Client Routing
- Two top-level sections: `/social/*` (social media) and `/quotes/*` (quote generation)
- Legacy routes redirect to `/social/*` prefixed equivalents
- Pages are flat in `client/src/pages/` (no nested folders)
