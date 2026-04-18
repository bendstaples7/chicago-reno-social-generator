# Requirements: Remove Express Server, Consolidate on Cloudflare Workers

## Background
The project currently maintains two parallel API implementations:
- `server/` — Express + PostgreSQL (used for local development)
- `worker/` — Hono + Cloudflare D1 (used for production)

This duplication has caused production bugs when changes are applied to one but not the other. The worker already has full feature parity and `wrangler dev` provides a complete local development environment.

## Goal
Eliminate the Express server entirely. All local development and production deployment runs through the Cloudflare Worker via Wrangler.

## Requirements

### REQ-1: Remove server/ package
- Delete the entire `server/` directory
- Remove `server` from the root `package.json` workspaces array
- Remove `dev:server` and `build:server` scripts from root `package.json`
- Run `npm install` to regenerate the lockfile without server dependencies

### REQ-2: Update client dev proxy
- Change `client/vite.config.ts` default proxy target from `http://localhost:3001` to `http://localhost:8787`
- Remove the `VITE_API_TARGET` env var conditional (no longer needed — only one backend)
- Rename `dev:client:worker` to `dev:client` in root `package.json` (or simplify to just `dev:client` pointing at :8787)

### REQ-3: Add worker dev script to root
- Add `dev:worker` script to root `package.json`: `npm run dev --workspace=worker`
- Add `build:worker` script to root `package.json`: `npm run build --workspace=worker`
- Optionally add a `dev` script that runs both client and worker concurrently

### REQ-4: Migrate tests importing from server/
- `tests/unit/cross-poster.test.ts` — repoint imports from `server/src/` to `worker/src/`, adapt mocks from `pg` query to D1 prepared statements
- `tests/unit/error-formatting.test.ts` — repoint imports from `server/src/errors/` and `server/src/middleware/` to `worker/src/` equivalents, adapt from Express middleware signature to Hono error handler
- Property tests (`auto-data-sync-preservation.property.test.ts`, `auto-data-sync-bug-condition.property.test.ts`) — update `readFileSync` paths from `server/src/` to `worker/src/`

### REQ-5: Create .dev.vars setup documentation
- `worker/.dev.vars` is a local-only secrets file and must NOT be committed to version control
- Ensure `worker/.dev.vars` (or the pattern `.dev.vars`) is listed in `.gitignore`
- Create a committed `worker/.dev.vars.example` file listing all required environment variable keys (no values), mirroring what `server/.env.example` had minus PostgreSQL/S3-specific vars
- Include instructions: copy `worker/.dev.vars.example` to `worker/.dev.vars` and populate with real secrets locally

### REQ-6: Update steering files
- Update `.kiro/steering/tech.md` — remove Server (Express) section, update monorepo description to three packages (client, worker, shared), update Common Commands
- Update `.kiro/steering/structure.md` — remove server/ from directory layout, update architecture patterns to reference worker only, update service layer and database sections
- Delete `.kiro/steering/server-worker-parity.md` — no longer needed since there's only one backend
- Update `.kiro/steering/product.md` if it references server

### REQ-7: Update GitHub Actions
- Update `.github/workflows/deploy-worker.yml` paths trigger — remove `server/` references if any, ensure worker changes still trigger deploy

### REQ-8: Verify everything works
- `npm install` succeeds without server workspace
- `npm test` — all tests pass (after migration)
- `npm run build:client` succeeds
- `npm run build:worker` succeeds
- `wrangler dev` starts successfully in worker/
- Client proxy connects to worker on :8787

### REQ-9: Clean up agent hook
- Remove or update the `server-worker-parity-check` Kiro hook since it's no longer relevant
