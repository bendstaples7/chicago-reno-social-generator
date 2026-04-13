-- Add source column to posts to distinguish generator-created vs Instagram-synced posts
ALTER TABLE posts ADD COLUMN source TEXT NOT NULL DEFAULT 'generator';

-- Index for filtering by source
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);
