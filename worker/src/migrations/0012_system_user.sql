-- Seed a 'system' user for background operations (corpus sync, webhook processing, etc.)
-- that need to write activity log entries without a real authenticated user.
INSERT INTO users (id, email, name)
VALUES ('system', 'system@internal', 'System')
ON CONFLICT (id) DO NOTHING;
