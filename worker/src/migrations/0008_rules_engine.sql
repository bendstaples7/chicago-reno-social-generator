-- Rules Engine: rule_groups and rules tables for D1 (SQLite)

-- ============================================================
-- RULE_GROUPS
-- ============================================================
CREATE TABLE IF NOT EXISTS rule_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unique group names (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_groups_name_lower ON rule_groups(name COLLATE NOCASE);

-- Seed the default "General" group
INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))), 'General', 'Default rule group for uncategorized rules', 0);

-- ============================================================
-- RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    rule_group_id TEXT NOT NULL REFERENCES rule_groups(id),
    priority_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unique rule name within a group
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_name_group ON rules(name, rule_group_id);
CREATE INDEX IF NOT EXISTS idx_rules_group_id ON rules(rule_group_id);
CREATE INDEX IF NOT EXISTS idx_rules_active ON rules(is_active);

-- ============================================================
-- LINE_ITEM_RULES (junction table)
-- ============================================================
CREATE TABLE IF NOT EXISTS line_item_rules (
    line_item_id TEXT NOT NULL,
    rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    quote_draft_id TEXT NOT NULL,
    PRIMARY KEY (line_item_id, rule_id, quote_draft_id)
);

CREATE INDEX IF NOT EXISTS idx_line_item_rules_draft ON line_item_rules(quote_draft_id);
CREATE INDEX IF NOT EXISTS idx_line_item_rules_rule ON line_item_rules(rule_id);
