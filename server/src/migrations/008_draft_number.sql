-- Add a sequential human-readable draft number to quote_drafts
CREATE SEQUENCE IF NOT EXISTS quote_draft_number_seq START 1;

ALTER TABLE quote_drafts
  ADD COLUMN IF NOT EXISTS draft_number INTEGER UNIQUE DEFAULT nextval('quote_draft_number_seq');

-- Backfill existing drafts with sequential numbers based on creation order
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM quote_drafts
  WHERE draft_number IS NULL
)
UPDATE quote_drafts
SET draft_number = numbered.rn
FROM numbered
WHERE quote_drafts.id = numbered.id;

-- Update the sequence to continue after the highest existing number
SELECT setval('quote_draft_number_seq', COALESCE((SELECT MAX(draft_number) FROM quote_drafts), 0) + 1, false);

-- Make it NOT NULL now that all rows have values
ALTER TABLE quote_drafts ALTER COLUMN draft_number SET NOT NULL;
