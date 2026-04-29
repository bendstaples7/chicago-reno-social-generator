-- Store the Jobber web URI for pushed quotes so the "View in Jobber" link
-- uses the correct URL instead of constructing one from quoteNumber.
-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE quote_drafts ADD COLUMN jobber_quote_web_uri TEXT DEFAULT NULL;
