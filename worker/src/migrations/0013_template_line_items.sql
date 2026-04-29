-- Add line_items_json column to manual_templates for structured template line items.
-- Templates now serve as full quote blueprints with line items that the AI uses
-- as a starting point when generating quotes.
-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE manual_templates ADD COLUMN line_items_json TEXT DEFAULT '[]';

-- Deduplicate any existing rows before adding the unique constraint.
-- Keeps the most recently created row for each (user_id, name) pair.
DELETE FROM manual_templates
WHERE rowid NOT IN (
  SELECT MAX(rowid)
  FROM manual_templates
  GROUP BY user_id, name COLLATE NOCASE
);

-- Unique template name per user (case-insensitive) to prevent duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_templates_user_name ON manual_templates(user_id, name COLLATE NOCASE);
