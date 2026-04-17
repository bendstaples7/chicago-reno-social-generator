-- Quote corpus: stores completed Jobber quotes with text embeddings
CREATE TABLE IF NOT EXISTS quote_corpus (
    id TEXT PRIMARY KEY,
    jobber_quote_id TEXT NOT NULL UNIQUE,
    quote_number TEXT NOT NULL,
    title TEXT,
    message TEXT,
    quote_status TEXT NOT NULL,
    searchable_text TEXT NOT NULL,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quote_corpus_jobber_id ON quote_corpus(jobber_quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_corpus_status ON quote_corpus(quote_status);
