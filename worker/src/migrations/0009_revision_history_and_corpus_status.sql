-- Revision history for quote draft feedback
CREATE TABLE IF NOT EXISTS quote_revision_history (
    id TEXT PRIMARY KEY,
    quote_draft_id TEXT NOT NULL,
    feedback_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quote_revision_history_draft_id ON quote_revision_history(quote_draft_id);

-- Singleton table tracking corpus sync state
-- (Allows the corpus status endpoint to return data even though
--  full corpus sync is not yet ported to the worker.)
CREATE TABLE IF NOT EXISTS quote_corpus_sync_status (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_sync_at TEXT,
    total_quotes INTEGER NOT NULL DEFAULT 0,
    last_sync_duration_ms INTEGER,
    last_sync_error TEXT
);

INSERT OR IGNORE INTO quote_corpus_sync_status (id, total_quotes) VALUES (1, 0);
