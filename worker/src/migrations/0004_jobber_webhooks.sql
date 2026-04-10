-- D1 (SQLite) schema for Jobber webhook request storage

CREATE TABLE IF NOT EXISTS jobber_webhook_requests (
    id TEXT PRIMARY KEY,
    jobber_request_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    account_id TEXT,
    title TEXT,
    client_name TEXT,
    description TEXT,
    request_body TEXT,
    image_urls TEXT DEFAULT '[]',
    raw_payload TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_requests_jobber_id ON jobber_webhook_requests(jobber_request_id);
CREATE INDEX IF NOT EXISTS idx_webhook_requests_received ON jobber_webhook_requests(received_at);
