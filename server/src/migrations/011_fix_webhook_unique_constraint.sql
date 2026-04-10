-- 011_fix_webhook_unique_constraint.sql
-- Fix the UNIQUE constraint to actually deduplicate webhook deliveries.
-- The old constraint included received_at (which defaults to NOW()), making it useless.

ALTER TABLE jobber_webhook_requests DROP CONSTRAINT IF EXISTS jobber_webhook_requests_jobber_request_id_topic_received_at_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_requests_dedup ON jobber_webhook_requests(jobber_request_id, topic);
