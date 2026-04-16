-- Store Jobber OAuth tokens in D1 so they survive worker cold starts.
-- The worker reads tokens from this table on each request, falling back
-- to Wrangler secrets/env vars if no row exists yet.

CREATE TABLE IF NOT EXISTS jobber_tokens (
  id TEXT PRIMARY KEY DEFAULT 'default',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
