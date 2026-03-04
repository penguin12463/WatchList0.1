-- Migration: Add watchlist_id to movie_progress
-- Changes primary key from (user_id, movie_id) to (user_id, movie_id, watchlist_id)
-- so watch progress and ratings are tracked independently per user per list.
-- This means the same movie in two lists has separate progress on each list.

-- 1. Add watchlist_id column (nullable initially so we can back-fill)
ALTER TABLE public.movie_progress
  ADD COLUMN IF NOT EXISTS watchlist_id bigint
    REFERENCES public.watchlists(id) ON DELETE CASCADE;

-- 2. Back-fill: for each progress row, find the list this user owns that contains the movie
UPDATE public.movie_progress mp
SET watchlist_id = wm.watchlist_id
FROM public.watchlist_movies wm
JOIN public.watchlists w ON w.id = wm.watchlist_id
WHERE wm.movie_id = mp.movie_id
  AND w.owner_id = mp.user_id
  AND mp.watchlist_id IS NULL;

-- 3. For any remaining rows (user is not the list owner), pick any list that contains the movie
UPDATE public.movie_progress mp
SET watchlist_id = (
  SELECT wm.watchlist_id
  FROM public.watchlist_movies wm
  WHERE wm.movie_id = mp.movie_id
  LIMIT 1
)
WHERE mp.watchlist_id IS NULL
  AND EXISTS (SELECT 1 FROM public.watchlist_movies wm WHERE wm.movie_id = mp.movie_id);

-- 4. Drop rows that still have no list association (orphaned progress)
DELETE FROM public.movie_progress WHERE watchlist_id IS NULL;

-- 5. Make the column NOT NULL now that back-fill is done
ALTER TABLE public.movie_progress
  ALTER COLUMN watchlist_id SET NOT NULL;

-- 6. Swap the primary key to include watchlist_id
ALTER TABLE public.movie_progress DROP CONSTRAINT IF EXISTS movie_progress_pkey;
ALTER TABLE public.movie_progress ADD PRIMARY KEY (user_id, movie_id, watchlist_id);

-- 7. Update the index to cover the new access pattern
DROP INDEX IF EXISTS idx_movie_progress_movie_id;
CREATE INDEX IF NOT EXISTS idx_movie_progress_lookup
  ON public.movie_progress(movie_id, watchlist_id);
