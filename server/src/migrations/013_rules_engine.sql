-- 013_rules_engine.sql
-- Rules Engine: rule_groups, rules, and line_item_rules tables

-- ============================================================
-- RULE_GROUPS
-- ============================================================
CREATE TABLE rule_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed the default "General" group
INSERT INTO rule_groups (id, name, description, display_order)
VALUES (uuid_generate_v4(), 'General', 'Default rule group for uncategorized rules', 0);

-- ============================================================
-- RULES
-- ============================================================
CREATE TABLE rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    rule_group_id UUID NOT NULL REFERENCES rule_groups(id),
    priority_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique rule name within a group
ALTER TABLE rules ADD CONSTRAINT uq_rules_name_group
    UNIQUE (name, rule_group_id);

CREATE INDEX idx_rules_group_id ON rules(rule_group_id);
CREATE INDEX idx_rules_active ON rules(is_active);

-- ============================================================
-- LINE_ITEM_RULES (junction table)
-- ============================================================
CREATE TABLE line_item_rules (
    line_item_id TEXT NOT NULL,
    rule_id UUID NOT NULL REFERENCES rules(id),
    quote_draft_id TEXT NOT NULL,
    PRIMARY KEY (line_item_id, rule_id)
);

CREATE INDEX idx_line_item_rules_draft ON line_item_rules(quote_draft_id);
CREATE INDEX idx_line_item_rules_rule ON line_item_rules(rule_id);
