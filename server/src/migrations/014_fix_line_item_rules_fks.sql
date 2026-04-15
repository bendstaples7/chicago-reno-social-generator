-- 014_fix_line_item_rules_fks.sql
-- Add missing ON DELETE CASCADE to line_item_rules foreign keys

-- Drop and re-add rule_id FK with CASCADE
ALTER TABLE line_item_rules DROP CONSTRAINT IF EXISTS line_item_rules_rule_id_fkey;
ALTER TABLE line_item_rules ADD CONSTRAINT line_item_rules_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE;

-- Convert quote_draft_id from TEXT to UUID so it can reference quote_drafts(id)
ALTER TABLE line_item_rules ALTER COLUMN quote_draft_id TYPE UUID USING quote_draft_id::uuid;

-- Add FK for quote_draft_id with CASCADE
ALTER TABLE line_item_rules ADD CONSTRAINT line_item_rules_quote_draft_id_fkey
    FOREIGN KEY (quote_draft_id) REFERENCES quote_drafts(id) ON DELETE CASCADE;
