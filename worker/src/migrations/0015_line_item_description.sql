-- Add description column to quote_line_items for product descriptions.
ALTER TABLE quote_line_items ADD COLUMN description TEXT NOT NULL DEFAULT '';
