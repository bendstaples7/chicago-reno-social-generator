-- Structured Rules: add condition/action JSON and trigger mode to rules table

-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE rules ADD COLUMN condition_json TEXT DEFAULT NULL;
-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE rules ADD COLUMN action_json TEXT DEFAULT NULL;
-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE rules ADD COLUMN trigger_mode TEXT NOT NULL DEFAULT 'chained';
