-- Add keywords column to manual_catalog_entries for AI product matching hints.
-- Stores comma-separated terms that help the AI select the correct product
-- when the customer request uses different terminology than the product name.
-- Example: "Flooring: Install New Hardwood" → keywords "wood floor, hardwood, wood flooring"
ALTER TABLE manual_catalog_entries ADD COLUMN keywords TEXT;

-- Separate keywords table for Jobber-sourced products (keyed by product name).
-- Merged onto catalog entries at query time regardless of source.
CREATE TABLE IF NOT EXISTS catalog_keywords (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    keywords TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, product_name)
);
