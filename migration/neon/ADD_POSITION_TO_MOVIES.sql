-- Add position column to watchlist_movies for drag-and-drop reordering
-- Run this once against the Neon database before deploying the reorder endpoint.

ALTER TABLE public.watchlist_movies
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Back-fill positions based on current insertion order (per watchlist)
UPDATE public.watchlist_movies wm
SET position = ordered.row_num
FROM (
  SELECT watchlist_id,
         movie_id,
         (ROW_NUMBER() OVER (
           PARTITION BY watchlist_id
           ORDER BY created_at ASC
         ) - 1) AS row_num
  FROM public.watchlist_movies
) ordered
WHERE wm.watchlist_id = ordered.watchlist_id
  AND wm.movie_id     = ordered.movie_id;

-- Optional: index for faster ordering queries
CREATE INDEX IF NOT EXISTS idx_watchlist_movies_position
  ON public.watchlist_movies (watchlist_id, position);
