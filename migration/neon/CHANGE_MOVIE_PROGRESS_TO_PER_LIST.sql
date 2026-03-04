-- Migration: Change movie_progress to be per-list (not per-user)
-- Progress and ratings are shared by all members of a list.
-- New primary key: (movie_id, watchlist_id)

-- Drop and recreate cleanly (table was just created, minimal data to lose).
DROP TABLE IF EXISTS public.movie_progress;

CREATE TABLE public.movie_progress (
  movie_id    bigint NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
  watchlist_id bigint NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
  watched_runtime  integer NULL,
  watched_episodes integer NULL,
  rating       integer NULL CHECK (rating BETWEEN 1 AND 5),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (movie_id, watchlist_id)
);

CREATE INDEX IF NOT EXISTS idx_movie_progress_watchlist
  ON public.movie_progress(watchlist_id);
