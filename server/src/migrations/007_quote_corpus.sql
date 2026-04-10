-- Quote corpus: stores completed Jobber quotes with text embeddings
CREATE TABLE IF NOT EXISTS quote_corpus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    jobber_quote_id VARCHAR(255) NOT NULL UNIQUE,
    quote_number VARCHAR(50) NOT NULL,
    title VARCHAR(500),
    message TEXT,
    quote_status VARCHAR(50) NOT NULL,
    searchable_text TEXT NOT NULL,
    embedding JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_corpus_jobber_id ON quote_corpus(jobber_quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_corpus_status ON quote_corpus(quote_status);

-- Singleton table tracking corpus sync state
CREATE TABLE IF NOT EXISTS quote_corpus_sync_status (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_sync_at TIMESTAMP,
    total_quotes INTEGER NOT NULL DEFAULT 0,
    last_sync_duration_ms INTEGER,
    last_sync_error TEXT
);

INSERT INTO quote_corpus_sync_status (id, total_quotes) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- Similar quote references linked to quote drafts
CREATE TABLE IF NOT EXISTS quote_draft_similar_quotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_draft_id UUID NOT NULL REFERENCES quote_drafts(id) ON DELETE CASCADE,
    jobber_quote_id VARCHAR(255) NOT NULL,
    quote_number VARCHAR(50) NOT NULL,
    title VARCHAR(500),
    similarity_score NUMERIC(5, 4) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_draft_similar_quotes_draft_id ON quote_draft_similar_quotes(quote_draft_id);
