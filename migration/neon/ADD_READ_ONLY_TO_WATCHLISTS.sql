-- Migration: Add is_read_only to watchlists + update v_user_watchlists view
-- When is_read_only = true, shared/invited members can no longer add, remove,
-- or reorder movies. Only the list owner retains write access.
--
-- Safe to run multiple times (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE VIEW).

-- 1. Add the column (defaults to false so existing lists are unaffected)
ALTER TABLE public.watchlists
  ADD COLUMN IF NOT EXISTS is_read_only boolean NOT NULL DEFAULT false;

-- 2. Recreate the view so all three branches expose is_read_only
--    is_read_only is appended AFTER existing columns to avoid shifting
--    column positions (which would cause a "cannot rename view column" error).
CREATE OR REPLACE VIEW public.v_user_watchlists AS
  SELECT
    w.id, w.name, w.owner_id, w.created_at,
    w.owner_id AS user_id,
    'owner'::text AS access_type,
    w.is_read_only
  FROM public.watchlists w
  UNION ALL
  SELECT
    w.id, w.name, w.owner_id, w.created_at,
    s.user_id,
    'shared'::text AS access_type,
    w.is_read_only
  FROM public.watchlists w
  JOIN public.watchlist_shares s ON s.watchlist_id = w.id
  UNION ALL
  SELECT
    w.id, w.name, w.owner_id, w.created_at,
    i.user_id,
    'invited'::text AS access_type,
    w.is_read_only
  FROM public.watchlists w
  JOIN public.watchlist_share_invitations i ON i.watchlist_id = w.id;
