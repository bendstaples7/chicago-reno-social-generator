-- Add description column to quote_line_items for product descriptions.
-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE quote_line_items ADD COLUMN description TEXT NOT NULL DEFAULT '';
