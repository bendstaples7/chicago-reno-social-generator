-- D1 (SQLite) migration for Quote Generation feature

-- Quote Drafts
CREATE TABLE IF NOT EXISTS quote_drafts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_request_text TEXT NOT NULL,
    selected_template_id TEXT,
    selected_template_name TEXT,
    catalog_source TEXT NOT NULL DEFAULT 'jobber',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quote_drafts_user_id ON quote_drafts(user_id);

-- Quote Line Items
CREATE TABLE IF NOT EXISTS quote_line_items (
    id TEXT PRIMARY KEY,
    quote_draft_id TEXT NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
    product_catalog_entry_id TEXT,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL DEFAULT 0,
    confidence_score INTEGER NOT NULL DEFAULT 0,
    original_text TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    unmatched_reason TEXT,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_draft_id ON quote_line_items(quote_draft_id);

-- Quote Media (join table for images attached to quote requests)
CREATE TABLE IF NOT EXISTS quote_media (
    id TEXT PRIMARY KEY,
    quote_draft_id TEXT NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
    media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_media_draft_id ON quote_media(quote_draft_id);

-- Manual Catalog Entries (for fallback mode)
CREATE TABLE IF NOT EXISTS manual_catalog_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    description TEXT,
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manual_catalog_user_id ON manual_catalog_entries(user_id);

-- Manual Templates (for fallback mode)
CREATE TABLE IF NOT EXISTS manual_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manual_templates_user_id ON manual_templates(user_id);
