-- ADD_COLLECTIONS.sql
-- Adds support for Collection items: a movie row can reference a sub-watchlist,
-- and a watchlist can reference its parent watchlist.

-- Extend the media_type check constraint to allow 'collection'
ALTER TABLE public.movies DROP CONSTRAINT IF EXISTS movies_media_type_check;
ALTER TABLE public.movies ADD CONSTRAINT movies_media_type_check
  CHECK (media_type IN ('movie', 'tv', 'collection'));

-- Sub-watchlist link on watchlists: if this is a collection sub-list, parent_list_id is set.
-- ON DELETE CASCADE ensures deleting the parent list also removes its sub-lists.
ALTER TABLE public.watchlists
  ADD COLUMN IF NOT EXISTS parent_list_id bigint
    REFERENCES public.watchlists(id) ON DELETE CASCADE;

-- Collection pointer on movies: if this movie item is a "Collection" type,
-- collection_list_id points to the sub-watchlist it navigates to.
-- ON DELETE SET NULL so removing the sub-list doesn't remove the movie item.
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS collection_list_id bigint
    REFERENCES public.watchlists(id) ON DELETE SET NULL;

-- Index for fast parent→children lookups
CREATE INDEX IF NOT EXISTS idx_watchlists_parent_list_id
  ON public.watchlists (parent_list_id)
  WHERE parent_list_id IS NOT NULL;
