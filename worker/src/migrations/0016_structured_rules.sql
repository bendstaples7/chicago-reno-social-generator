-- Structured Rules: add condition/action JSON and trigger mode to rules table

ALTER TABLE rules ADD COLUMN condition_json TEXT DEFAULT NULL;
ALTER TABLE rules ADD COLUMN action_json TEXT DEFAULT NULL;
ALTER TABLE rules ADD COLUMN trigger_mode TEXT NOT NULL DEFAULT 'chained';
