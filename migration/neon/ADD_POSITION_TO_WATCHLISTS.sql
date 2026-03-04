-- Migration: Add user_list_positions table for personal nav ordering
-- Stores each user's preferred order for all their lists (owned, shared, and invited).
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.user_list_positions (
  user_id      text   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  watchlist_id bigint NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, watchlist_id)
);

CREATE INDEX IF NOT EXISTS idx_user_list_positions_user
  ON public.user_list_positions(user_id);
