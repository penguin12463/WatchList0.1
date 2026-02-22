# Watchlyst Static Client

This is the static-host migration target that preserves current features:
- Sign up / sign in
- Create, rename, delete watchlists
- Shared access and invitations (accept/decline)
- Add/remove movies
- Progress tracking (watched runtime/episodes, rating)
- TMDB search/details via secure edge function

## Configure
1. Copy values into `config.js` from Supabase project settings:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2. Run `migration/supabase/schema.sql` in Supabase SQL editor.
3. Deploy edge function in `migration/functions/tmdb-proxy/index.ts` and set secrets.

## Host for free
- GitHub Pages or Cloudflare Pages can host this `static-client` folder.
- Build step is not required (plain static files).

## Local test
Open `index.html` with a static server, e.g.

```bash
python3 -m http.server 5500
```

Then browse to `http://localhost:5500/static-client/`.
