-- Add pending_enrichments column to track async AI enrichment processing.
-- 0 means all enrichments are complete (or none were needed).
ALTER TABLE quote_drafts ADD COLUMN pending_enrichments INTEGER NOT NULL DEFAULT 0;
