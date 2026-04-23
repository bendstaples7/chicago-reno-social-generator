-- Convert the "paint supplies" rule from legacy (prompt-only) to structured.
-- Rule: "if there is a painting line item in the quote, we need to include paint supplies as a line item"
--
-- This rule triggers when "Interior Painting" exists as a line item and adds
-- "Materials: Paint Supplies" (qty 1, $100) deterministically.
-- The rule uses trigger_mode 'chained' so it also fires when another rule adds
-- a painting line item during the execution loop.

UPDATE rules
SET condition_json = '{"type":"line_item_exists","productNamePattern":"Interior Painting"}',
    action_json = '[{"type":"add_line_item","productName":"Materials: Paint Supplies","quantity":1,"unitPrice":100,"description":"Brushes, Rollers, Tape, Drop Cloths"}]',
    trigger_mode = 'chained',
    updated_at = datetime('now')
WHERE id = '6f2b55b6-a827-4fc2-8276-71f593623dcd';

-- Also convert the "customer to provide paint" description rule to structured.
-- Rule: "If a painting labor item is referenced in the quote, the description should say Customer to provide paint"
-- This uses set_description to deterministically set the description on Interior Painting line items.

UPDATE rules
SET condition_json = '{"type":"line_item_exists","productNamePattern":"Interior Painting"}',
    action_json = '[{"type":"set_description","productNamePattern":"Interior Painting","description":"Customer to provide paint"}]',
    trigger_mode = 'chained',
    updated_at = datetime('now')
WHERE id = '9a23a82d-9ffe-48a4-8558-3522a7f7e5e5';
