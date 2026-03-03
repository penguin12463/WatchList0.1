-- Migration: Add movie_progress table
-- Moves per-user watch progress (watched_runtime, watched_episodes, rating) out of the
-- shared `movies` row and into a dedicated `movie_progress` table keyed by (user_id, movie_id).
-- This prevents users on a shared list from overwriting each other's progress.
--
-- Safe to run multiple times (all statements use IF NOT EXISTS / ON CONFLICT).

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.movie_progress (
  user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  movie_id bigint NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
  watched_runtime integer NULL,
  watched_episodes integer NULL,
  rating integer NULL CHECK (rating BETWEEN 1 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, movie_id)
);

CREATE INDEX IF NOT EXISTS idx_movie_progress_movie_id ON public.movie_progress(movie_id);

-- 2. Back-fill existing progress from the movies table into movie_progress.
--    We attribute any existing progress to the movie's creator (created_by field).
--    Only rows that have at least one non-null progress value are migrated.
INSERT INTO public.movie_progress (user_id, movie_id, watched_runtime, watched_episodes, rating)
SELECT
  m.created_by,
  m.id,
  m.watched_runtime,
  m.watched_episodes,
  m.rating
FROM public.movies m
WHERE m.created_by IS NOT NULL
  AND (m.watched_runtime IS NOT NULL
    OR m.watched_episodes IS NOT NULL
    OR m.rating IS NOT NULL)
ON CONFLICT (user_id, movie_id) DO NOTHING;
