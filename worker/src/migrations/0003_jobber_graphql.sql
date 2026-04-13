-- D1 (SQLite) migration for Jobber GraphQL Integration

ALTER TABLE quote_drafts ADD COLUMN jobber_request_id TEXT;
