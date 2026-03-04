// @ts-nocheck
import { Hono } from "hono";
import { cors } from "hono/cors";
import { neon } from "@neondatabase/serverless";
import { verifyToken } from "@clerk/backend";

type Env = {
  DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  CORS_ORIGIN?: string;
  TMDB_API_KEY?: string;
};

type Variables = {
  userId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const corsOrigin = c.env.CORS_ORIGIN || "*";
  const corsMiddleware = cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600
  });
  return corsMiddleware(c, next);
});

app.use("/api/*", async (c, next) => {
  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return c.json({ error: "Missing bearer token" }, 401);
  }

  try {
    const verified = await verifyToken(token, { secretKey: c.env.CLERK_SECRET_KEY });
    const userId = String(verified.sub || "");
    if (!userId) {
      return c.json({ error: "Invalid token subject" }, 401);
    }

    c.set("userId", userId);
    await next();
  } catch (err) {
    return c.json({ error: "Invalid token", detail: String(err) }, 401);
  }
});

const db = (env: Env) => neon(env.DATABASE_URL);

app.get("/health", async (c) => {
  try {
    const sql = db(c.env);
    await sql`select 1`;
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ ok: false, error: String(error) }, 503);
  }
});

app.post("/api/profile/ensure", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ username?: string; email?: string }>();
  const emailLocalPart = String(body.email || "").split("@")[0] || "";
  const candidateUsername = (body.username || emailLocalPart || userId).trim().slice(0, 50);
  const sql = db(c.env);

  await sql`select public.ensure_profile(${userId}, ${candidateUsername})`;
  return c.json({ ok: true });
});

app.get("/api/lists", async (c) => {
  const userId = c.get("userId");
  const sql = db(c.env);

  // Try to read is_read_only + personal position from user_list_positions; fallback if migration pending.
  let rows;
  try {
    rows = await sql`
      select v.id, v.name, v.owner_id, v.access_type, v.is_read_only, v.created_at
      from public.v_user_watchlists v
      left join public.user_list_positions ulp
        on ulp.watchlist_id = v.id and ulp.user_id = ${userId}
      where v.user_id = ${userId}
      order by ulp.position asc nulls last, v.created_at asc
    `;
  } catch {
    rows = await sql`
      select id, name, owner_id, access_type, false as is_read_only, created_at
      from public.v_user_watchlists
      where user_id = ${userId}
      order by created_at asc
    `;
  }

  return c.json(rows);
});

// Single-list info — includes owner_username for shared/invited views
app.get("/api/lists/:id/info", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const sql = db(c.env);

  // Try to read is_read_only from the updated view; fallback if migration hasn't run yet.
  let rows;
  try {
    rows = await sql`
      select v.id, v.name, v.owner_id, v.access_type, v.is_read_only,
             p.username as owner_username
      from public.v_user_watchlists v
      join public.profiles p on p.id = v.owner_id
      where v.id = ${listId} and v.user_id = ${userId}
      limit 1
    `;
  } catch {
    rows = await sql`
      select v.id, v.name, v.owner_id, v.access_type, false as is_read_only,
             p.username as owner_username
      from public.v_user_watchlists v
      join public.profiles p on p.id = v.owner_id
      where v.id = ${listId} and v.user_id = ${userId}
      limit 1
    `;
  }

  if (!rows.length) {
    return c.json({ error: "List not found or inaccessible" }, 404);
  }

  return c.json(rows[0]);
});

app.post("/api/lists", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name || "New List").trim().slice(0, 50) || "New List";
  const sql = db(c.env);

  const rows = await sql`
    insert into public.watchlists (name, owner_id)
    values (${name}, ${userId})
    returning id, name, owner_id, created_at
  `;

  return c.json(rows[0], 201);
});

app.patch("/api/lists/reorder", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ ids: number[] }>();
  const ids = body.ids;

  if (!Array.isArray(ids) || !ids.length) {
    return c.json({ error: "ids array required" }, 400);
  }

  const sql = db(c.env);

  // Upsert personal positions for all list types (owned, shared, invited).
  await sql`
    INSERT INTO public.user_list_positions (user_id, watchlist_id, position)
    SELECT ${userId}, vals.list_id, vals.pos
    FROM (
      SELECT
        unnest(${ids}::int[]) AS list_id,
        generate_series(0, ${ids.length - 1}) AS pos
    ) AS vals
    ON CONFLICT (user_id, watchlist_id) DO UPDATE
      SET position = excluded.position
  `;

  return c.body(null, 204);
});

app.patch("/api/lists/:id", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string; is_read_only?: boolean }>();
  const name = (body.name || "").trim().slice(0, 50);
  const hasName = name.length > 0;
  const hasReadOnly = typeof body.is_read_only === "boolean";

  if (!hasName && !hasReadOnly) {
    return c.json({ error: "Nothing to update" }, 400);
  }

  const sql = db(c.env);
  // Try to update is_read_only; if the column doesn't exist yet (migration pending),
  // fall back to a name-only update.
  let rows;
  try {
    rows = await sql`
      update public.watchlists
      set
        name = case when ${hasName}::boolean then ${name}::text else name end,
        is_read_only = case when ${hasReadOnly}::boolean then ${body.is_read_only ?? false}::boolean else is_read_only end
      where id = ${listId} and owner_id = ${userId}
      returning id, name, is_read_only
    `;
  } catch {
    if (!hasName) {
      return c.json({ error: "Migration required to use read-only setting" }, 503);
    }
    rows = await sql`
      update public.watchlists
      set name = ${name}
      where id = ${listId} and owner_id = ${userId}
      returning id, name
    `;
  }

  if (!rows.length) {
    return c.json({ error: "List not found or not owned by user" }, 404);
  }

  return c.json(rows[0]);
});

app.delete("/api/lists/:id", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const sql = db(c.env);

  await sql`select public.delete_or_leave_watchlist(${listId}, ${userId})`;
  return c.body(null, 204);
});

app.get("/api/lists/:id/movies", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const sql = db(c.env);

  // Progress is shared per list — joined on (movie_id, watchlist_id), no user filter.
  let rows;
  try {
    rows = await sql`
      select m.id, m.title, m.media_type, m.tmdb_id, m.runtime, m.number_of_episodes,
             m.created_by, m.created_at,
             mp.watched_runtime, mp.watched_episodes, mp.rating
      from public.watchlist_movies wm
      join public.movies m on m.id = wm.movie_id
      left join public.movie_progress mp
        on mp.movie_id = m.id and mp.watchlist_id = ${listId}
      where wm.watchlist_id = ${listId}
        and public.is_watchlist_accessible(${listId}, ${userId})
      order by wm.position asc, wm.created_at asc
    `;
  } catch {
    // movie_progress table not yet migrated — fall back to shared columns on movies row.
    rows = await sql`
      select m.id, m.title, m.media_type, m.tmdb_id, m.runtime, m.number_of_episodes,
             m.created_by, m.created_at,
             m.watched_runtime, m.watched_episodes, m.rating
      from public.watchlist_movies wm
      join public.movies m on m.id = wm.movie_id
      where wm.watchlist_id = ${listId}
        and public.is_watchlist_accessible(${listId}, ${userId})
      order by wm.position asc, wm.created_at asc
    `;
  }

  return c.json(rows);
});

app.get("/api/lists/:id/shared-users", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const sql = db(c.env);

  const ownerRows = await sql`
    select 1
    from public.watchlists
    where id = ${listId} and owner_id = ${userId}
  `;

  if (!ownerRows.length) {
    return c.json([], 200);
  }

  const rows = await sql`
    select s.user_id, p.username
    from public.watchlist_shares s
    join public.profiles p on p.id = s.user_id
    where s.watchlist_id = ${listId}
    order by s.created_at asc
  `;

  return c.json(rows);
});

app.post("/api/lists/:id/movies", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const body = await c.req.json<{
    title?: string;
    media_type?: string | null;
    tmdb_id?: number | null;
    runtime?: number | null;
    number_of_episodes?: number | null;
  }>();

  const title = (body.title || "").trim().slice(0, 120);
  if (!title) {
    return c.json({ error: "Title is required" }, 400);
  }

  // If no tmdb_id was provided (user typed title manually without picking from autocomplete),
  // auto-search TMDB and use the top result so we always have a unique ID to deduplicate on.
  if (!body.tmdb_id && c.env.TMDB_API_KEY) {
    try {
      const searchUrl = `${TMDB_BASE}/search/multi?api_key=${c.env.TMDB_API_KEY}&query=${encodeURIComponent(title)}&include_adult=false&page=1`;
      const searchResp = await fetch(searchUrl);
      if (searchResp.ok) {
        const searchData: any = await searchResp.json();
        const topResult = (searchData.results || []).find(
          (r: any) => r.media_type === "movie" || r.media_type === "tv"
        );
        if (topResult) {
          body.media_type = topResult.media_type;
          body.tmdb_id = topResult.id;
          const detailUrl = topResult.media_type === "movie"
            ? `${TMDB_BASE}/movie/${topResult.id}?api_key=${c.env.TMDB_API_KEY}`
            : `${TMDB_BASE}/tv/${topResult.id}?api_key=${c.env.TMDB_API_KEY}`;
          const detailResp = await fetch(detailUrl);
          if (detailResp.ok) {
            const detail: any = await detailResp.json();
            if (topResult.media_type === "movie") {
              body.runtime = detail.runtime || null;
            } else {
              body.number_of_episodes = detail.number_of_episodes || null;
              body.runtime = Array.isArray(detail.episode_run_time) && detail.episode_run_time.length
                ? detail.episode_run_time[0]
                : null;
            }
          }
        }
      }
    } catch {
      // If TMDB lookup fails, continue with just the title — better than refusing to add
    }
  }

  const sql = db(c.env);

  // Block writes when the list is read-only and the requester is not the owner.
  // Skipped gracefully if the migration hasn't run yet (is_read_only column missing).
  try {
    const accessCheck = await sql`
      SELECT access_type, is_read_only FROM public.v_user_watchlists
      WHERE id = ${listId} AND user_id = ${userId}
    `;
    if (!accessCheck.length) return c.json({ error: "List not found or inaccessible" }, 404);
    if (accessCheck[0].is_read_only && accessCheck[0].access_type !== "owner") {
      return c.json({ error: "This list is read-only" }, 403);
    }
  } catch { /* migration pending — allow the write */ }

  const rows = await sql`
    select public.add_movie_to_watchlist(
      ${listId},
      ${title},
      ${body.media_type || null},
      ${body.tmdb_id || null},
      ${body.runtime || null},
      ${body.number_of_episodes || null},
      ${userId}
    ) as movie_id
  `;

  const newMovieId = rows[0]?.movie_id;
  if (newMovieId) {
    // Place new movie at the end of the list
    await sql`
      UPDATE public.watchlist_movies
      SET position = (
        SELECT COALESCE(MAX(position), -1) + 1
        FROM public.watchlist_movies
        WHERE watchlist_id = ${listId}
      )
      WHERE watchlist_id = ${listId}
        AND movie_id = ${newMovieId}
    `;
  }

  return c.json(rows[0], 201);
});

app.patch("/api/movies/:id", async (c) => {
  const userId = c.get("userId");
  const movieId = Number(c.req.param("id"));
  const body = await c.req.json<{
    list_id?: number;
    title?: string | null;
    media_type?: string | null;
    runtime?: number | null;
    number_of_episodes?: number | null;
    watched_runtime?: number | null;
    watched_episodes?: number | null;
    rating?: number | null;
  }>();

  const sql = db(c.env);

  // If a list_id is provided, check whether the list is read-only for this user.
  // Non-owners on a read-only list may not edit shared movie metadata.
  let canEditShared = true;
  if (body.list_id) {
    try {
      const access = await sql`
        SELECT access_type, is_read_only FROM public.v_user_watchlists
        WHERE id = ${body.list_id} AND user_id = ${userId}
      `;
      if (access.length) {
        canEditShared = !access[0].is_read_only || access[0].access_type === "owner";
      }
    } catch {
      // is_read_only migration not yet applied — allow edit (safe default).
    }
  }

  if (canEditShared) {
    // Update shared movie metadata (title, type, total runtime/episodes) on the movies table.
    const movieRows = await sql`
      update public.movies m
      set title = coalesce(${body.title ?? null}, title),
          media_type = coalesce(${body.media_type ?? null}, media_type),
          runtime = ${body.runtime ?? null},
          number_of_episodes = ${body.number_of_episodes ?? null}
      where m.id = ${movieId}
        and exists (
          select 1
          from public.watchlist_movies wm
          join public.watchlists w on w.id = wm.watchlist_id
          where wm.movie_id = m.id
            and public.is_watchlist_accessible(w.id, ${userId})
        )
      returning m.id
    `;
    if (!movieRows.length) {
      return c.json({ error: "Movie not found or inaccessible" }, 404);
    }
  } else {
    // Read-only list: verify access without updating shared fields.
    const accessRows = await sql`
      SELECT m.id FROM public.movies m
      WHERE m.id = ${movieId}
        AND EXISTS (
          SELECT 1 FROM public.watchlist_movies wm
          WHERE wm.movie_id = m.id
            AND public.is_watchlist_accessible(wm.watchlist_id, ${userId})
        )
    `;
    if (!accessRows.length) {
      return c.json({ error: "Movie not found or inaccessible" }, 404);
    }
  }

  // Upsert shared per-list watch progress — blocked for non-owners on read-only lists.
  // Falls back to movies table columns if the migration hasn't run yet.
  if (body.list_id && canEditShared) {
    try {
      await sql`
        insert into public.movie_progress (movie_id, watchlist_id, watched_runtime, watched_episodes, rating)
        values (${movieId}, ${body.list_id}, ${body.watched_runtime ?? null}, ${body.watched_episodes ?? null}, ${body.rating ?? null})
        on conflict (movie_id, watchlist_id) do update
        set watched_runtime = excluded.watched_runtime,
            watched_episodes = excluded.watched_episodes,
            rating = excluded.rating
      `;
    } catch {
      // movie_progress table not yet migrated — fall back to shared columns on movies row.
      await sql`
        UPDATE public.movies
        SET watched_runtime = ${body.watched_runtime ?? null},
            watched_episodes = ${body.watched_episodes ?? null},
            rating = ${body.rating ?? null}
        WHERE id = ${movieId}
      `;
    }
  }

  // Return the movie with progress for this list.
  try {
    const rows = await sql`
      select m.id, m.title, m.media_type, m.runtime, m.number_of_episodes,
             mp.watched_runtime, mp.watched_episodes, mp.rating
      from public.movies m
      left join public.movie_progress mp
        on mp.movie_id = m.id and mp.watchlist_id = ${body.list_id ?? null}
      where m.id = ${movieId}
    `;
    return c.json(rows[0]);
  } catch {
    const rows = await sql`
      SELECT id, title, media_type, runtime, number_of_episodes,
             watched_runtime, watched_episodes, rating
      FROM public.movies WHERE id = ${movieId}
    `;
    return c.json(rows[0]);
  }
});

app.patch("/api/lists/:id/movies/reorder", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const body = await c.req.json<{ ids: number[] }>();
  const ids = body.ids;

  if (!Array.isArray(ids) || !ids.length) {
    return c.json({ error: "ids array required" }, 400);
  }

  const sql = db(c.env);

  // Verify access (owner or shared — not invited; and not read-only for non-owners).
  // is_read_only check is skipped gracefully if the migration hasn't run yet.
  let accessType: string;
  try {
    const access = await sql`
      SELECT access_type, is_read_only FROM public.v_user_watchlists
      WHERE id = ${listId} AND user_id = ${userId}
    `;
    if (!access.length || access[0].access_type === "invited") {
      return c.json({ error: "Forbidden" }, 403);
    }
    if (access[0].is_read_only && access[0].access_type !== "owner") {
      return c.json({ error: "This list is read-only" }, 403);
    }
    accessType = access[0].access_type;
  } catch {
    // Fallback without is_read_only (migration pending)
    const access = await sql`
      SELECT access_type FROM public.v_user_watchlists
      WHERE id = ${listId} AND user_id = ${userId}
    `;
    if (!access.length || access[0].access_type === "invited") {
      return c.json({ error: "Forbidden" }, 403);
    }
    accessType = access[0].access_type;
  }

  // Update every movie's position in one statement via unnest
  await sql`
    UPDATE public.watchlist_movies AS wm
    SET position = vals.pos
    FROM (
      SELECT
        unnest(${ids}::int[]) AS movie_id,
        generate_series(0, ${ids.length - 1}) AS pos
    ) AS vals
    WHERE wm.watchlist_id = ${listId}
      AND wm.movie_id = vals.movie_id
  `;

  return c.body(null, 204);
});

app.delete("/api/lists/:listId/movies/:movieId", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("listId"));
  const movieId = Number(c.req.param("movieId"));
  const sql = db(c.env);

  // Block non-owners on read-only lists.
  // Skipped gracefully if the migration hasn't run yet (is_read_only column missing).
  try {
    const accessCheck = await sql`
      SELECT access_type, is_read_only FROM public.v_user_watchlists
      WHERE id = ${listId} AND user_id = ${userId}
    `;
    if (!accessCheck.length) return c.body(null, 404);
    if (accessCheck[0].is_read_only && accessCheck[0].access_type !== "owner") {
      return c.json({ error: "This list is read-only" }, 403);
    }
  } catch { /* migration pending — allow the delete */ }

  await sql`
    delete from public.watchlist_movies wm
    where wm.watchlist_id = ${listId}
      and wm.movie_id = ${movieId}
      and public.is_watchlist_accessible(${listId}, ${userId})
  `;

  return c.body(null, 204);
});

app.delete("/api/lists/:listId/shared-users/:userId", async (c) => {
  const currentUserId = c.get("userId");
  const listId = Number(c.req.param("listId"));
  const targetUserId = String(c.req.param("userId"));
  const sql = db(c.env);

  const ownerRows = await sql`
    select 1
    from public.watchlists
    where id = ${listId} and owner_id = ${currentUserId}
  `;

  if (!ownerRows.length) {
    return c.json({ error: "Only owner can remove shared users" }, 403);
  }

  await sql`
    delete from public.watchlist_shares
    where watchlist_id = ${listId}
      and user_id = ${targetUserId}
  `;

  return c.body(null, 204);
});

app.post("/api/lists/:id/invite", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const body = await c.req.json<{ username?: string }>();
  const username = (body.username || "").trim();

  if (!username) {
    return c.json({ error: "Username is required" }, 400);
  }

  const sql = db(c.env);
  await sql`select public.invite_user_by_username(${listId}, ${username}, ${userId})`;
  return c.json({ ok: true });
});

app.post("/api/lists/:id/accept", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const sql = db(c.env);
  await sql`select public.accept_invitation(${listId}, ${userId})`;
  return c.json({ ok: true });
});

app.post("/api/lists/:id/decline", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const sql = db(c.env);
  await sql`select public.decline_invitation(${listId}, ${userId})`;
  return c.json({ ok: true });
});

// ── TMDB proxy ──

const TMDB_BASE = "https://api.themoviedb.org/3";

app.get("/api/tmdb/search", async (c) => {
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) return c.json({ results: [] });
  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json({ results: [] });

  const url = `${TMDB_BASE}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(q)}&include_adult=false&page=1`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ results: [] });
  const data: any = await resp.json();

  const results = (data.results || [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 8)
    .map((r: any) => ({
      id: r.id,
      media_type: r.media_type,
      title: r.media_type === "movie" ? r.title : r.name,
      year: r.media_type === "movie"
        ? (r.release_date || "").slice(0, 4)
        : (r.first_air_date || "").slice(0, 4),
      runtime: r.media_type === "movie"
        ? (r.runtime || null)
        : (Array.isArray(r.episode_run_time) && r.episode_run_time.length ? r.episode_run_time[0] : null),
    }));

  return c.json({ results });
});

app.get("/api/tmdb/movie/:id", async (c) => {
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) return c.json({ error: "No TMDB key" }, 503);
  const tmdbId = c.req.param("id");
  const url = `${TMDB_BASE}/movie/${tmdbId}?api_key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ error: "TMDB error" }, 502);
  const data: any = await resp.json();
  return c.json({
    id: data.id,
    title: data.title,
    runtime: data.runtime || null,
    release_date: (data.release_date || "").slice(0, 4),
  });
});

app.get("/api/tmdb/tv/:id", async (c) => {
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) return c.json({ error: "No TMDB key" }, 503);
  const tmdbId = c.req.param("id");
  const url = `${TMDB_BASE}/tv/${tmdbId}?api_key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) return c.json({ error: "TMDB error" }, 502);
  const data: any = await resp.json();
  return c.json({
    id: data.id,
    name: data.name,
    number_of_episodes: data.number_of_episodes || null,
    episode_run_time: Array.isArray(data.episode_run_time) && data.episode_run_time.length ? data.episode_run_time[0] : null,
    first_air_date: (data.first_air_date || "").slice(0, 4),
  });
});

export default app;
