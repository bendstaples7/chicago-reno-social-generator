-- Unified product catalog: single table replacing manual_catalog_entries + catalog_keywords.
-- All products (Jobber-sourced and manual) live here with sort order and keywords on the row.

CREATE TABLE IF NOT EXISTS product_catalog (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    category TEXT,
    sort_order INTEGER NOT NULL DEFAULT 500,
    keywords TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    jobber_active INTEGER NOT NULL DEFAULT 1,
    locally_modified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_product_catalog_user_sort ON product_catalog(user_id, sort_order);
