-- D1 (SQLite) schema for Social Media Cross-Poster
-- Converted from PostgreSQL schema

-- Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User Settings
CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    advisor_mode TEXT NOT NULL DEFAULT 'manual',
    approval_mode TEXT NOT NULL DEFAULT 'manual_review',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Channel Connections
CREATE TABLE IF NOT EXISTS channel_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL,
    external_account_id TEXT,
    external_account_name TEXT,
    access_token_encrypted TEXT,
    token_expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_channel_connections_user_id ON channel_connections(user_id);

-- Posts
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_connection_id TEXT REFERENCES channel_connections(id) ON DELETE SET NULL,
    content_type TEXT NOT NULL,
    caption TEXT,
    hashtags_json TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    external_post_id TEXT,
    template_fields TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);

-- Media Items
CREATE TABLE IF NOT EXISTS media_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    thumbnail_url TEXT,
    source TEXT NOT NULL DEFAULT 'uploaded',
    ai_description TEXT,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_items_user_id ON media_items(user_id);

-- Post Media (join table)
CREATE TABLE IF NOT EXISTS post_media (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_post_media_media_item_id ON post_media(media_item_id);

-- Activity Log Entries
CREATE TABLE IF NOT EXISTS activity_log_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    component TEXT NOT NULL,
    operation TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    description TEXT NOT NULL,
    recommended_action TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_log_entries_user_id ON activity_log_entries(user_id);

-- Team Members
CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    bio_snippet TEXT,
    photo_media_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- Content Ideas
CREATE TABLE IF NOT EXISTS content_ideas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    idea TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_content_ideas_user_id ON content_ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_content_ideas_content_type ON content_ideas(content_type);

-- Image Generation Jobs (new table for Queue workflow)
CREATE TABLE IF NOT EXISTS image_generation_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    description TEXT,
    style TEXT,
    count INTEGER NOT NULL DEFAULT 1,
    topic TEXT,
    result_media_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_user_id ON image_generation_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_status ON image_generation_jobs(status);

-- OAuth States (CSRF protection for OAuth flows)
CREATE TABLE IF NOT EXISTS oauth_states (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user_id ON oauth_states(user_id);
