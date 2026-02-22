# Watchlyst Migration Runbook (Server -> Static + Supabase)

## Phase 1: Database + security
1. Create Supabase project.
2. Run `migration/supabase/schema.sql`.
3. Confirm tables exist and RLS is enabled.

## Phase 2: Auth
1. Enable Email auth provider in Supabase.
2. Configure site URL + redirect URL for your static host.

## Phase 3: TMDB secret handling
1. Deploy edge function:
   - `supabase functions deploy tmdb-proxy`
2. Set secrets:
   - `supabase secrets set TMDB_API_KEY=<key> TMDB_BASE_URL=https://api.themoviedb.org/3`

## Phase 4: Static app setup
1. Edit `static-client/config.js`.
2. Run local static server and verify:
   - signup/signin
   - create list
   - invite/accept/decline
   - add/update/remove movies

## Phase 5: Deploy static app
Option A (GitHub Pages):
- Publish `static-client` folder.

Option B (Cloudflare Pages):
- Connect repo, set root directory to `static-client`, no build command.

## Feature parity notes
- Core features are preserved.
- Existing Blazor server app remains in repo unchanged as fallback.

## Cutover checklist
- [ ] Validate 2 test users and sharing flow.
- [ ] Validate TMDB lookup works from edge function.
- [ ] Export/backup old SQLite DB.
- [ ] Point DNS/custom domain to static host.

## Production hardening checklist
- [ ] Rotate TMDB API key in TMDB dashboard.
- [ ] Update Supabase secret with the rotated key:
   - `supabase secrets set TMDB_API_KEY=<new-key> TMDB_BASE_URL=https://api.themoviedb.org/3 --project-ref itozjiieewburafwwqhm`
- [ ] Keep `service_role` key out of frontend code (frontend must only use anon key).
- [ ] In Supabase Authentication settings:
   - [ ] Enable email confirmation.
   - [ ] Configure bot/rate protections for auth endpoints.
   - [ ] Keep Site URL and Redirect URLs limited to your production domain(s).

## Backup and recovery
- Supabase backup cadence (minimum):
   - Weekly full backup export.
   - Pre-release backup before schema or policy changes.
- Suggested backup command (`pg_dump` with Supabase connection string):
   - `pg_dump --format=custom --file=watchlyst_$(date +%F).dump "<SUPABASE_DB_CONNECTION_STRING>"`
- Recovery drill (monthly):
   - Restore backup into a staging database.
   - Verify sign-in, list creation, sharing, and movie updates.

## Repository visibility and code split
- Current repo is public and contains both legacy server code and static client code.
- If you only want static app public, split into:
   - Public repo: `static-client` only.
   - Private repo: legacy/server code and historical configs.
