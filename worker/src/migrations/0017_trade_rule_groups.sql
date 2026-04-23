-- Seed trade-based rule groups for organizing rules by trade/category.
-- The "General" group (display_order 0) already exists from migration 0008.
-- These groups are ordered alphabetically after General.

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Appliances', 'Rules for appliance-related line items', 1);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Carpentry', 'Rules for carpentry and woodwork line items', 2);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Countertops', 'Rules for countertop-related line items', 3);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Demo', 'Rules for demolition line items', 4);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Drywall', 'Rules for drywall and patching line items', 5);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Electrical', 'Rules for electrical line items', 6);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Exterior', 'Rules for exterior work line items', 7);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'HVAC', 'Rules for heating, ventilation, and air conditioning line items', 8);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Insulation', 'Rules for insulation line items', 9);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Painting', 'Rules for interior and exterior painting line items', 10);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Plumbing', 'Rules for plumbing line items', 11);

INSERT OR IGNORE INTO rule_groups (id, name, description, display_order)
VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  'Tile', 'Rules for tile installation and related line items', 12);
