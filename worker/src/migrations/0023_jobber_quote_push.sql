-- Add Jobber quote tracking columns to quote_drafts.
-- These are populated after a successful push to Jobber via the quoteCreate mutation.
ALTER TABLE quote_drafts ADD COLUMN jobber_quote_id TEXT DEFAULT NULL;
ALTER TABLE quote_drafts ADD COLUMN jobber_quote_number TEXT DEFAULT NULL;
