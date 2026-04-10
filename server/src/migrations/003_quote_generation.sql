-- 003_quote_generation.sql
-- Quote generation tables for draft quotes, line items, media, and manual fallback data

-- ============================================================
-- QUOTE_DRAFTS
-- ============================================================
CREATE TABLE quote_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_request_text TEXT NOT NULL,
    selected_template_id VARCHAR(255),
    selected_template_name VARCHAR(255),
    catalog_source VARCHAR(50) NOT NULL DEFAULT 'jobber',
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_drafts_user_id ON quote_drafts(user_id);

-- ============================================================
-- QUOTE_LINE_ITEMS
-- ============================================================
CREATE TABLE quote_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_draft_id UUID NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
    product_catalog_entry_id VARCHAR(255),
    product_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    confidence_score INTEGER NOT NULL DEFAULT 0,
    original_text TEXT NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    unmatched_reason TEXT,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_quote_line_items_draft_id ON quote_line_items(quote_draft_id);

-- ============================================================
-- QUOTE_MEDIA (join table for images attached to quote requests)
-- ============================================================
CREATE TABLE quote_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_draft_id UUID NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_quote_media_draft_id ON quote_media(quote_draft_id);

-- ============================================================
-- MANUAL_CATALOG_ENTRIES (for fallback mode)
-- ============================================================
CREATE TABLE manual_catalog_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    description TEXT,
    category VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_manual_catalog_user_id ON manual_catalog_entries(user_id);

-- ============================================================
-- MANUAL_TEMPLATES (for fallback mode)
-- ============================================================
CREATE TABLE manual_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_manual_templates_user_id ON manual_templates(user_id);
