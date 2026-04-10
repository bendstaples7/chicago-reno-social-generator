# Tech Stack & Build System

## Monorepo Structure
- **npm workspaces** with three packages: `client`, `server`, `shared`
- A fourth package `worker` exists as a Cloudflare Workers deployment target (migration in progress)
- Shared base TypeScript config in `tsconfig.base.json` (ES2022, ESNext modules, bundler resolution, strict mode)

## Client
- **React 18** with **TypeScript**
- **Vite** for dev server and bundling
- **react-router-dom v6** for routing (two sections: `/social/*` and `/quotes/*`)
- No state management library — uses React context (`AuthContext`, `ErrorToastProvider`)
- API layer in `client/src/api.ts` — plain `fetch` calls with Bearer token auth via localStorage

## Server (Express — legacy/dev)
- **Express 4** with **TypeScript**
- **tsx** for dev mode (`tsx watch`)
- **PostgreSQL** via `pg` driver
- **AWS S3** via `@aws-sdk/client-s3` for media storage
- **dotenv** for environment config
- Routes under `server/src/routes/`, services under `server/src/services/`

## Worker (Cloudflare Workers — production target)
- **Hono** web framework
- **Cloudflare D1** (SQLite) for database
- **Cloudflare R2** for object storage
- **Cloudflare Queues** for async image generation jobs
- **Wrangler** for dev/deploy
- SQL migrations in `worker/src/migrations/`
- Bindings typed in `worker/src/bindings.ts`

## Shared Package
- Pure TypeScript types — no runtime dependencies
- Exports all types from `shared/src/types/`
- Used by both client and server via workspace dependency

## Testing
- **Vitest** (v2) as test runner, configured at repo root
- **fast-check** for property-based testing
- Test files: `tests/unit/*.test.ts`, `tests/property/*.property.test.ts`
- Test helpers in `tests/unit/helpers/` (mock D1, R2, Queue)

## Common Commands

```bash
# Run all tests (single run, no watch)
npm test

# Run tests in watch mode
npm run test:watch

# Dev servers (run these manually in separate terminals)
npm run dev:client    # Vite dev server on :5173, proxies /api to :3001
npm run dev:server    # Express via tsx watch on :3001

# Build
npm run build:client
npm run build:server

# Worker (from worker/ directory)
npm run dev           # wrangler dev
npm run deploy        # wrangler deploy
npm run build         # tsc -b
```

## Key External Integrations
- **OpenAI API** — text generation (content, quotes) and embeddings (similarity search)
- **Instagram Graph API** — post publishing, account management
- **Jobber GraphQL API** — customer requests, products, quotes, webhooks
