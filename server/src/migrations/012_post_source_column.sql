-- Add source column to posts to distinguish generator-created vs Instagram-synced posts
ALTER TABLE posts ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT 'generator';

-- Index for filtering by source
CREATE INDEX idx_posts_source ON posts(source);
