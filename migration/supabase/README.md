# Supabase Migration Setup

1. Create a Supabase project.
2. Run `schema.sql` in SQL Editor.
3. In Authentication > Providers, enable Email.
4. In Authentication > URL Configuration, add your static site URL.
5. Deploy edge function:
   - `supabase functions deploy tmdb-proxy`
   - `supabase secrets set TMDB_API_KEY=... TMDB_BASE_URL=https://api.themoviedb.org/3`
6. Use anon key + URL in your static client env.

## Notes
- RLS is enabled on all tables.
- Sharing/invite flows are implemented via SQL functions.
- This keeps all existing app features: login, watchlists, movies, sharing, invitations.
