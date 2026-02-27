/**
 * One-shot migration runner — adds the position column to watchlist_movies.
 *
 * Run from the neon-worker directory (where @neondatabase/serverless is installed):
 *
 *   cd neon-worker
 *   DATABASE_URL="postgresql://user:pass@host/db?sslmode=require" node ../migration/neon/run-migration.mjs
 *
 * Get your DATABASE_URL from: https://console.neon.tech
 *   → Select your project → Connection Details → copy the "pooled connection" string
 */

import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("ERROR: DATABASE_URL environment variable is not set.");
  console.error(
    'Usage: DATABASE_URL="postgresql://..." node migration/neon/run-migration.mjs'
  );
  process.exit(1);
}

const sql = neon(url);

console.log("Running migration: ADD_POSITION_TO_MOVIES …");

try {
  // Add the column (safe to run multiple times)
  await sql`
    ALTER TABLE public.watchlist_movies
      ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0
  `;
  console.log("  ✓  Column added (or already exists)");

  // Back-fill positions from insertion order
  await sql`
    UPDATE public.watchlist_movies wm
    SET position = ordered.row_num
    FROM (
      SELECT
        watchlist_id,
        movie_id,
        (ROW_NUMBER() OVER (
          PARTITION BY watchlist_id
          ORDER BY created_at ASC
        ) - 1) AS row_num
      FROM public.watchlist_movies
    ) ordered
    WHERE wm.watchlist_id = ordered.watchlist_id
      AND wm.movie_id     = ordered.movie_id
  `;
  console.log("  ✓  Positions back-filled from existing insertion order");

  // Index
  await sql`
    CREATE INDEX IF NOT EXISTS idx_watchlist_movies_position
      ON public.watchlist_movies (watchlist_id, position)
  `;
  console.log("  ✓  Index created (or already exists)");

  console.log("\nMigration complete. You can now deploy the worker:");
  console.log("  cd neon-worker && npx wrangler deploy");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
}
