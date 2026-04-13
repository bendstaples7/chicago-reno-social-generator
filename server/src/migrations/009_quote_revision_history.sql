-- Revision history for quote draft feedback
CREATE TABLE quote_revision_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_draft_id UUID NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
    feedback_text TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_revision_history_draft_id ON quote_revision_history(quote_draft_id);
