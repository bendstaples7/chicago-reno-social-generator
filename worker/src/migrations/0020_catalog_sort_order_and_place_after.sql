-- Add sort_order to manual_catalog_entries for renovation workflow ordering.
-- Lower numbers appear first on quotes.
-- IDEMPOTENCY: column may already exist; deploy will apply manually if needed
ALTER TABLE manual_catalog_entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 500;

-- Seed sort orders by trade prefix (renovation workflow sequence):
-- Demo/Debris first, then structural, rough-in trades, finishes, materials last.
UPDATE manual_catalog_entries SET sort_order = 100 WHERE name LIKE 'Demo%' OR name LIKE 'Debris%';
UPDATE manual_catalog_entries SET sort_order = 150 WHERE name LIKE 'Insulation%';
UPDATE manual_catalog_entries SET sort_order = 200 WHERE name LIKE 'Electrical%';
UPDATE manual_catalog_entries SET sort_order = 250 WHERE name LIKE 'Plumbing%';
UPDATE manual_catalog_entries SET sort_order = 300 WHERE name LIKE 'HVAC%';
UPDATE manual_catalog_entries SET sort_order = 350 WHERE name LIKE 'Drywall%';
UPDATE manual_catalog_entries SET sort_order = 400 WHERE name LIKE 'Tile%';
UPDATE manual_catalog_entries SET sort_order = 450 WHERE name LIKE 'Carpentry%';
UPDATE manual_catalog_entries SET sort_order = 460 WHERE name LIKE 'Cabinet%';
UPDATE manual_catalog_entries SET sort_order = 500 WHERE name LIKE 'Painting%' OR name LIKE 'Interior Painting%' OR name LIKE 'Exterior Painting%';
UPDATE manual_catalog_entries SET sort_order = 510 WHERE name LIKE 'Cabinet Paint%';
UPDATE manual_catalog_entries SET sort_order = 550 WHERE name LIKE 'Countertop%';
UPDATE manual_catalog_entries SET sort_order = 600 WHERE name LIKE 'Appliance%';
UPDATE manual_catalog_entries SET sort_order = 650 WHERE name LIKE 'Exterior%' AND name NOT LIKE 'Exterior Painting%';
UPDATE manual_catalog_entries SET sort_order = 700 WHERE name LIKE 'Misc%';
UPDATE manual_catalog_entries SET sort_order = 800 WHERE name LIKE 'Materials%';
UPDATE manual_catalog_entries SET sort_order = 900 WHERE name LIKE 'Labor%' OR name LIKE 'Architectural%';

-- Materials get sort_order just above their parent trade so they group together:
UPDATE manual_catalog_entries SET sort_order = 101 WHERE name = 'Materials: Demo Supplies';
UPDATE manual_catalog_entries SET sort_order = 401 WHERE name = 'Materials: Shower Pan';
UPDATE manual_catalog_entries SET sort_order = 501 WHERE name = 'Materials: Paint Supplies';
UPDATE manual_catalog_entries SET sort_order = 502 WHERE name = 'Materials: Interior Paint';
UPDATE manual_catalog_entries SET sort_order = 503 WHERE name = 'Materials: Exterior Paint';
UPDATE manual_catalog_entries SET sort_order = 461 WHERE name = 'Materials: Cabinet Door';
UPDATE manual_catalog_entries SET sort_order = 462 WHERE name = 'Materials: Cabinet Patch';
UPDATE manual_catalog_entries SET sort_order = 463 WHERE name = 'Materials: Cabinet Pulls';
UPDATE manual_catalog_entries SET sort_order = 464 WHERE name = 'Materials: Cabinets';

-- Update existing add_line_item rules to include placeAfter
UPDATE rules SET action_json = '[{"type":"add_line_item","productName":"Materials: Paint Supplies","quantity":1,"unitPrice":100,"description":"Brushes, Rollers, Tape, Drop Cloths","placeAfter":"Interior Painting"}]'
WHERE id = '6f2b55b6-a827-4fc2-8276-71f593623dcd';

UPDATE rules SET action_json = '[{"type":"add_line_item","productName":"Materials: Demo Supplies","quantity":1,"unitPrice":100,"placeAfter":"Demo"}]'
WHERE id = '7a865d07-9c16-4e8c-bcf4-0822aa40b035';

UPDATE rules SET action_json = '[{"type":"add_line_item","productName":"Materials: Shower Pan","quantity":1,"unitPrice":100,"placeAfter":"Tile: Construct Shower Pan"}]'
WHERE id = 'd5c66bdd-02e9-42c3-8855-7ec01dbd0eb8';
