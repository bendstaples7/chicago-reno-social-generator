-- Jobber products imported from CSV export
CREATE TABLE IF NOT EXISTS jobber_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(500) NOT NULL,
    description TEXT DEFAULT '',
    category VARCHAR(100) DEFAULT 'Service',
    unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    imported_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobber_products_active ON jobber_products(active);
CREATE INDEX idx_jobber_products_name ON jobber_products(name);
