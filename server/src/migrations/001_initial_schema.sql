-- 001_initial_schema.sql
-- Initial database schema for Social Media Cross-Poster

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USER_SETTINGS
-- ============================================================
CREATE TABLE user_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    advisor_mode VARCHAR(50) NOT NULL DEFAULT 'manual',
    approval_mode VARCHAR(50) NOT NULL DEFAULT 'manual_review',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);

-- ============================================================
-- CHANNEL_CONNECTIONS
-- ============================================================
CREATE TABLE channel_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type VARCHAR(50) NOT NULL,
    external_account_id VARCHAR(255),
    external_account_name VARCHAR(255),
    access_token_encrypted TEXT,
    token_expires_at TIMESTAMP,
    status VARCHAR(50) NOT NULL DEFAULT 'disconnected',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channel_connections_user_id ON channel_connections(user_id);

-- ============================================================
-- POSTS
-- ============================================================
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_connection_id UUID REFERENCES channel_connections(id) ON DELETE SET NULL,
    content_type VARCHAR(50) NOT NULL,
    caption TEXT,
    hashtags_json TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    external_post_id VARCHAR(255),
    template_fields JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    published_at TIMESTAMP
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_status ON posts(status);

-- ============================================================
-- MEDIA_ITEMS
-- ============================================================
CREATE TABLE media_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    storage_key VARCHAR(512) NOT NULL,
    thumbnail_url VARCHAR(512),
    source VARCHAR(50) NOT NULL DEFAULT 'uploaded',
    ai_description TEXT,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_items_user_id ON media_items(user_id);

-- ============================================================
-- POST_MEDIA (join table)
-- ============================================================
CREATE TABLE post_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_post_media_post_id ON post_media(post_id);
CREATE INDEX idx_post_media_media_item_id ON post_media(media_item_id);

-- ============================================================
-- ACTIVITY_LOG_ENTRIES
-- ============================================================
CREATE TABLE activity_log_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    component VARCHAR(255) NOT NULL,
    operation VARCHAR(255) NOT NULL,
    severity VARCHAR(50) NOT NULL DEFAULT 'info',
    description TEXT NOT NULL,
    recommended_action TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_log_entries_user_id ON activity_log_entries(user_id);

-- ============================================================
-- TEAM_MEMBERS
-- ============================================================
CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    role VARCHAR(255) NOT NULL,
    bio_snippet TEXT,
    photo_media_id VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SESSIONS (auth session management)
-- ============================================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(512) NOT NULL UNIQUE,
    last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_token ON sessions(token);
