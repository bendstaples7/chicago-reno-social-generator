-- 016_jobber_token_store.sql
-- Store Jobber OAuth tokens in PostgreSQL so they survive server restarts.
-- The server reads tokens from this table on startup, falling back to
-- .env values when no row exists yet (first run / migration not applied).

CREATE TABLE IF NOT EXISTS jobber_tokens (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
