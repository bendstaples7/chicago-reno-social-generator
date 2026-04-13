-- Fix the deduplication index for webhook requests.
-- Ensures only one row per (jobber_request_id, topic) pair.

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_requests_dedup ON jobber_webhook_requests(jobber_request_id, topic);
