-- Cache for Jobber quote templates
CREATE TABLE IF NOT EXISTS jobber_templates_cache (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    content TEXT DEFAULT '',
    cached_at TIMESTAMP NOT NULL DEFAULT NOW()
);
