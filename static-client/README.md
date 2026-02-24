# Watchlyst Static Client

This is the static-host client for the Neon + Cloudflare Worker backend with Clerk auth.

It preserves current features:
- Sign up / sign in
- Create, rename, delete watchlists
- Shared access and invitations (accept/decline)
- Add/remove movies
- Progress tracking

## Configure
1. Copy values into `config.js`:
   - `CLERK_PUBLISHABLE_KEY`
   - `WORKER_API_BASE_URL`
2. Ensure your Worker is deployed and healthy (`GET /health` returns `ok`).
3. Ensure Neon schema is applied from `migration/neon/schema.sql`.

## Host for free
- GitHub Pages or Cloudflare Pages can host this `static-client` folder.
- Build step is not required (plain static files).

## Local test
Open `index.html` with a static server, e.g.

```bash
python3 -m http.server 5500
```

Then browse to `http://localhost:5500/static-client/`.
