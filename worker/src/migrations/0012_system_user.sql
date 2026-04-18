-- Seed a 'system' user for background operations (corpus sync, webhook processing, etc.)
-- that need to write activity log entries without a real authenticated user.
-- Uses INSERT OR IGNORE to skip on any unique constraint conflict (id or email).
INSERT OR IGNORE INTO users (id, email, name)
VALUES ('system', 'system@internal', 'System');
