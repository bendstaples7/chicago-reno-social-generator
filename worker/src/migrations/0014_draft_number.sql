-- Add sequential draft_number column to quote_drafts.
-- Each user gets their own sequence (per-user auto-increment).

ALTER TABLE quote_drafts ADD COLUMN draft_number INTEGER;

-- Backfill existing drafts with sequential numbers per user, ordered by creation date.
UPDATE quote_drafts
SET draft_number = (
  SELECT COUNT(*)
  FROM quote_drafts AS qd2
  WHERE qd2.user_id = quote_drafts.user_id
    AND qd2.created_at <= quote_drafts.created_at
    AND (qd2.created_at < quote_drafts.created_at OR qd2.id <= quote_drafts.id)
);
