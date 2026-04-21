-- Add line_items_json column to manual_templates for structured template line items.
-- Templates now serve as full quote blueprints with line items that the AI uses
-- as a starting point when generating quotes.
ALTER TABLE manual_templates ADD COLUMN line_items_json TEXT DEFAULT '[]';
