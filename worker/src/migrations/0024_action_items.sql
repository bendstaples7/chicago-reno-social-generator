-- Action items: callouts attached to line items that need additional user input
-- (measurements, quantities) before the quote can be finalized.
CREATE TABLE IF NOT EXISTS action_items (
    id TEXT PRIMARY KEY,
    quote_draft_id TEXT NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
    line_item_id TEXT NOT NULL,
    description TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_action_items_draft_id ON action_items(quote_draft_id);
