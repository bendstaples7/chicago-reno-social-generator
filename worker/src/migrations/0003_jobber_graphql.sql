-- D1 (SQLite) migration for Jobber GraphQL Integration

-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE quote_drafts ADD COLUMN jobber_request_id TEXT;
