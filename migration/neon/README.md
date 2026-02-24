# Watchlyst Neon Migration (Free Path)

This path replaces Supabase with:
- Neon Postgres (database)
- Clerk (auth)
- Cloudflare Workers (free API layer)

## 1) Create Neon database
1. Create a Neon project and copy the pooled connection string.
2. Run [schema.sql](schema.sql) in Neon SQL Editor.
3. Run [CLEANUP_AND_HARDENING.sql](CLEANUP_AND_HARDENING.sql).

## 2) Create Clerk app
1. Create a Clerk app.
2. Enable email/password sign-in.
3. Copy:
   - `CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`

Detailed steps: see [CLERK_SETUP.md](CLERK_SETUP.md).

## 3) Configure Worker
From `neon-worker/`:

```bash
npm install
npx wrangler secret put DATABASE_URL
npx wrangler secret put CLERK_SECRET_KEY
```

You can copy `neon-worker/.dev.vars.example` to `neon-worker/.dev.vars` for local dev.

Set allowed frontend origin in `wrangler.toml` `CORS_ORIGIN`.

Deploy:

```bash
npm run deploy
```

## 4) API surface implemented
- `GET /health`
- `GET /api/lists`
- `POST /api/lists`
- `PATCH /api/lists/:id`
- `DELETE /api/lists/:id`
- `GET /api/lists/:id/movies`
- `POST /api/lists/:id/movies`
- `PATCH /api/movies/:id`
- `DELETE /api/lists/:listId/movies/:movieId`
- `POST /api/lists/:id/invite`
- `POST /api/lists/:id/accept`
- `POST /api/lists/:id/decline`

All `/api/*` routes require `Authorization: Bearer <clerk-jwt>`.

## 5) Frontend wiring required (next step)
- Replace Supabase auth calls with Clerk frontend SDK.
- Replace Supabase table/RPC calls with Worker API calls.
- Keep the same UI and IDs so UX remains unchanged.

## 6) Why this is healthier
- No direct browser-to-DB credentials.
- Auth and DB concerns are separated.
- Worker can fail fast and provide controlled retries/circuit-breaking.
