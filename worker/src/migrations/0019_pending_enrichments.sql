-- Add pending_enrichments column to track async AI enrichment processing.
-- 0 means all enrichments are complete (or none were needed).
-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE quote_drafts ADD COLUMN pending_enrichments INTEGER NOT NULL DEFAULT 0;
