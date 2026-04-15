-- 015_fix_line_item_rules_pk.sql
-- Include quote_draft_id in the primary key so the same line_item-rule
-- association can exist across different drafts.

ALTER TABLE line_item_rules DROP CONSTRAINT line_item_rules_pkey;
ALTER TABLE line_item_rules ADD PRIMARY KEY (line_item_id, rule_id, quote_draft_id);
