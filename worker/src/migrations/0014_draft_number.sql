-- Add sequential draft_number column to quote_drafts.
-- Each user gets their own sequence (per-user auto-increment).

ALTER TABLE quote_drafts ADD COLUMN draft_number INTEGER;

-- Backfill existing drafts with sequential numbers per user, ordered by creation date.
-- Uses ROW_NUMBER() window function for correct, duplicate-free numbering.
UPDATE quote_drafts
SET draft_number = (
  SELECT rn FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rn
    FROM quote_drafts
  ) AS numbered
  WHERE numbered.id = quote_drafts.id
);

-- Enforce per-user uniqueness so concurrent inserts fail rather than silently duplicate.
CREATE UNIQUE INDEX unique_user_draft_number ON quote_drafts(user_id, draft_number);
