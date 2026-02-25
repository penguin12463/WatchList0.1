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

  const rows = await sql`
    select id, name, owner_id, access_type, created_at
    from public.v_user_watchlists
    where user_id = ${userId}
    order by created_at asc
  `;

  return c.json(rows);
});

// Single-list info — includes owner_username for shared/invited views
app.get("/api/lists/:id/info", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const sql = db(c.env);

  const rows = await sql`
    select v.id, v.name, v.owner_id, v.access_type,
           p.username as owner_username
    from public.v_user_watchlists v
    join public.profiles p on p.id = v.owner_id
    where v.id = ${listId} and v.user_id = ${userId}
    limit 1
  `;

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

app.patch("/api/lists/:id", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("id"));
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name || "").trim().slice(0, 50);

  if (!name) {
    return c.json({ error: "List name is required" }, 400);
  }

  const sql = db(c.env);
  const rows = await sql`
    update public.watchlists
    set name = ${name}
    where id = ${listId} and owner_id = ${userId}
    returning id, name
  `;

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

  const rows = await sql`
    select m.*
    from public.watchlist_movies wm
    join public.movies m on m.id = wm.movie_id
    where wm.watchlist_id = ${listId}
      and public.is_watchlist_accessible(${listId}, ${userId})
    order by wm.created_at asc
  `;

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

  const sql = db(c.env);

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

  return c.json(rows[0], 201);
});

app.patch("/api/movies/:id", async (c) => {
  const userId = c.get("userId");
  const movieId = Number(c.req.param("id"));
  const body = await c.req.json<{
    title?: string | null;
    media_type?: string | null;
    runtime?: number | null;
    number_of_episodes?: number | null;
    watched_runtime?: number | null;
    watched_episodes?: number | null;
    rating?: number | null;
  }>();

  const sql = db(c.env);

  const rows = await sql`
    update public.movies m
    set title = coalesce(${body.title ?? null}, title),
        media_type = coalesce(${body.media_type ?? null}, media_type),
        runtime = ${body.runtime ?? null},
        number_of_episodes = ${body.number_of_episodes ?? null},
        watched_runtime = ${body.watched_runtime ?? null},
        watched_episodes = ${body.watched_episodes ?? null},
        rating = ${body.rating ?? null}
    where m.id = ${movieId}
      and exists (
        select 1
        from public.watchlist_movies wm
        join public.watchlists w on w.id = wm.watchlist_id
        where wm.movie_id = m.id
          and public.is_watchlist_accessible(w.id, ${userId})
      )
    returning m.id, m.title, m.media_type, m.runtime, m.number_of_episodes,
              m.watched_runtime, m.watched_episodes, m.rating
  `;

  if (!rows.length) {
    return c.json({ error: "Movie not found or inaccessible" }, 404);
  }

  return c.json(rows[0]);
});

app.delete("/api/lists/:listId/movies/:movieId", async (c) => {
  const userId = c.get("userId");
  const listId = Number(c.req.param("listId"));
  const movieId = Number(c.req.param("movieId"));
  const sql = db(c.env);

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
    first_air_date: (data.first_air_date || "").slice(0, 4),
  });
});

export default app;
