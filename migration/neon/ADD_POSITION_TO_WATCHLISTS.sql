-- Migration: Add position column to watchlists for user-defined nav ordering
-- Only the list owner can reorder their lists; position is stored on the watchlists row.
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS, UPDATE ... WHERE position IS NULL).

-- 1. Add the column (nullable — back-filled below)
ALTER TABLE public.watchlists
  ADD COLUMN IF NOT EXISTS position integer;

-- 2. Back-fill: assign sequential positions per owner ordered by created_at
UPDATE public.watchlists w
SET position = sub.pos
FROM (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY owner_id ORDER BY created_at) - 1 AS pos
  FROM public.watchlists
) sub
WHERE w.id = sub.id
  AND w.position IS NULL;
