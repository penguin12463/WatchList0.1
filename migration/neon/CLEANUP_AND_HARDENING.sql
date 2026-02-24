-- Run on Neon after schema import. Safe idempotent cleanup.

begin;

update public.profiles
set username = lower(trim(username))
where username <> lower(trim(username));

drop index if exists profiles_username_ci_unique;
create unique index if not exists profiles_username_ci_unique
  on public.profiles (lower(username));

create index if not exists idx_watchlists_owner_id on public.watchlists(owner_id);
create index if not exists idx_movies_created_by on public.movies(created_by);
create index if not exists idx_watchlist_movies_movie_id on public.watchlist_movies(movie_id);
create index if not exists idx_watchlist_shares_user_id on public.watchlist_shares(user_id);
create index if not exists idx_watchlist_invites_user_id on public.watchlist_share_invitations(user_id);
create index if not exists idx_watchlist_invites_watchlist_id on public.watchlist_share_invitations(watchlist_id);

analyze public.profiles;
analyze public.watchlists;
analyze public.movies;
analyze public.watchlist_movies;
analyze public.watchlist_shares;
analyze public.watchlist_share_invitations;

commit;
