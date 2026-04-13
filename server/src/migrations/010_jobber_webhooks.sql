-- 010_jobber_webhooks.sql
-- Store full request data received via Jobber webhooks

CREATE TABLE IF NOT EXISTS jobber_webhook_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    jobber_request_id VARCHAR(255) NOT NULL,
    topic VARCHAR(100) NOT NULL,
    account_id VARCHAR(255),
    title TEXT,
    client_name TEXT,
    description TEXT,
    request_body TEXT,
    image_urls JSONB DEFAULT '[]'::jsonb,
    raw_payload JSONB NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP,
    UNIQUE(jobber_request_id, topic, received_at)
);

CREATE INDEX idx_webhook_requests_jobber_id ON jobber_webhook_requests(jobber_request_id);
CREATE INDEX idx_webhook_requests_received ON jobber_webhook_requests(received_at DESC);
