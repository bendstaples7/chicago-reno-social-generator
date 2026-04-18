# Design: Remove Express Server, Consolidate on Cloudflare Workers

## Overview
This is a deletion/simplification change, not a feature build. The design is straightforward: remove the server package and rewire everything to point at the worker.

## Files to Delete
- Entire `server/` directory (services, routes, config, middleware, errors, migrations, scripts, env files, tsconfig, package.json)

## Files to Modify

### Root package.json
```json
{
  "workspaces": ["client", "shared", "worker"],
  "scripts": {
    "test": "vitest --run",
    "test:watch": "vitest",
    "dev:client": "npm run dev --workspace=client",
    "dev:worker": "npm run dev --workspace=worker",
    "build:client": "npm run build --workspace=client",
    "build:worker": "npm run build --workspace=worker"
  }
}
```
Remove: `dev:server`, `build:server`, `dev:client:worker`, `server` from workspaces.

### client/vite.config.ts
Hardcode proxy to `:8787`, remove `VITE_API_TARGET` conditional:
```ts
proxy: {
  '/api': {
    target: 'http://localhost:8787',
    changeOrigin: true,
  },
},
```

### Test Migration Strategy

**tests/unit/cross-poster.test.ts**
- Currently imports `CrossPoster` from `server/src/services/cross-poster.js` and mocks `pg` query
- Worker's `CrossPoster` takes a `D1Database` in constructor instead of using a global `query` function
- Rewrite to use `mock-d1.ts` helper (already exists) and import from `worker/src/services/cross-poster.js`
- This is the most involved test migration — the mock pattern changes from `vi.mock('../../server/src/config/database.js')` to creating a `MockD1Database`

**tests/unit/error-formatting.test.ts**
- Currently imports `PlatformError`, `formatErrorResponse`, `errorHandler` from server
- Worker has identical `PlatformError` and `formatErrorResponse` in `worker/src/errors/`
- Worker's error handler is a Hono `onError` handler, not Express middleware — different signature
- Rewrite error handler tests to use Hono's error handler pattern, or test only `PlatformError` and `formatErrorResponse` (which are framework-agnostic)

**Property tests (auto-data-sync-*.property.test.ts)**
- Use `readFileSync` to read server source files for structural assertions
- Change paths from `server/src/routes/quotes.ts` → `worker/src/routes/quotes.ts`, etc.
- Verify the structural assertions still hold against worker source (they should — the logic is mirrored)

### Steering Files

**tech.md** — Rewrite to reflect three-package monorepo (client, worker, shared). Remove Express/PostgreSQL/S3 sections. Update commands.

**structure.md** — Remove server/ from directory layout. Update architecture patterns to reference worker paths. Update database section to D1 only.

**server-worker-parity.md** — Delete entirely.

### .dev.vars.example
Create `worker/.dev.vars.example` with all required env vars:
- AI_TEXT_API_KEY
- FB_PAGE_ACCESS_TOKEN
- IG_BUSINESS_ACCOUNT_ID
- CHANNEL_ENCRYPTION_KEY
- INSTAGRAM_CLIENT_SECRET
- INSTAGRAM_CLIENT_ID
- JOBBER_CLIENT_ID
- JOBBER_CLIENT_SECRET
- JOBBER_ACCESS_TOKEN
- JOBBER_REFRESH_TOKEN

(Database, S3, and PORT vars are not needed — D1 and R2 are handled by Wrangler bindings.)

## Risk Assessment
- **Low risk**: Deleting server/, updating scripts, updating steering files
- **Medium risk**: Migrating `cross-poster.test.ts` (mock pattern changes significantly)
- **Low risk**: Property test path changes (just string replacements)
- **No risk to production**: Worker code is unchanged; only the dev/test infrastructure changes
