/**
 * Runs the ADD_MOVIE_PROGRESS_TABLE migration against a Neon database.
 *
 * Run from the neon-worker directory (where @neondatabase/serverless is installed):
 *
 *   cd neon-worker
 *   DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node ../migration/neon/run-movie-progress-migration.mjs
 *
 * Get your DATABASE_URL from: https://console.neon.tech
 *   → Select your project → Connection Details → copy the "pooled connection" string
 */

import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  console.error(
    'Usage: DATABASE_URL="postgresql://..." node ../migration/neon/run-movie-progress-migration.mjs'
  );
  process.exit(1);
}

const sql = neon(url);

console.log("Running migration: ADD_MOVIE_PROGRESS_TABLE …");

try {
  // 1. Create the movie_progress table
  await sql`
    CREATE TABLE IF NOT EXISTS public.movie_progress (
      user_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      movie_id bigint NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
      watched_runtime integer NULL,
      watched_episodes integer NULL,
      rating integer NULL CHECK (rating BETWEEN 1 AND 5),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, movie_id)
    )
  `;
  console.log("  ✓  movie_progress table created (or already exists)");

  // 2. Index
  await sql`
    CREATE INDEX IF NOT EXISTS idx_movie_progress_movie_id
      ON public.movie_progress (movie_id)
  `;
  console.log("  ✓  Index created (or already exists)");

  // 3. Back-fill existing progress from the shared movies table, attributing it to
  //    the user who originally created the movie (created_by).
  await sql`
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
    ON CONFLICT (user_id, movie_id) DO NOTHING
  `;
  console.log("  ✓  Existing progress back-filled to movie_progress");

  console.log("\nMigration complete.");
} catch (err) {
  console.error("\nMigration FAILED:", err);
  process.exit(1);
}
