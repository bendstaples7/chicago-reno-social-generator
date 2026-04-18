-- Store Jobber web session cookies in D1 for accessing internal API fields.
-- Cookies are set manually and expire after 24 hours.

CREATE TABLE IF NOT EXISTS jobber_web_session (
  id TEXT PRIMARY KEY DEFAULT 'default',
  cookies TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
