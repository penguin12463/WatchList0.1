-- Neon schema for Watchlyst (Clerk user IDs as text)
-- Run in Neon SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id text primary key,
  username text not null unique check (char_length(username) between 1 and 50),
  created_at timestamptz not null default now()
);

create table if not exists public.watchlists (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 50),
  owner_id text not null references public.profiles(id) on delete cascade,
  is_read_only boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.movies (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 120),
  media_type text null check (media_type in ('movie', 'tv')),
  tmdb_id integer null,
  runtime integer null,
  watched_runtime integer null,
  number_of_episodes integer null,
  watched_episodes integer null,
  rating integer null check (rating between 1 and 5),
  created_by text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_movies_tmdb on public.movies(media_type, tmdb_id)
where media_type is not null and tmdb_id is not null;

create table if not exists public.watchlist_movies (
  watchlist_id bigint not null references public.watchlists(id) on delete cascade,
  movie_id bigint not null references public.movies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (watchlist_id, movie_id)
);

create table if not exists public.watchlist_shares (
  watchlist_id bigint not null references public.watchlists(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (watchlist_id, user_id)
);

create table if not exists public.watchlist_share_invitations (
  id bigint generated always as identity primary key,
  watchlist_id bigint not null references public.watchlists(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (watchlist_id, user_id)
);

-- Per-user watch progress and ratings.
-- Keeps watched_runtime / watched_episodes / rating out of the shared movies row
-- so users on the same shared list each maintain independent progress.
create table if not exists public.movie_progress (
  movie_id     bigint not null references public.movies(id) on delete cascade,
  watchlist_id bigint not null references public.watchlists(id) on delete cascade,
  watched_runtime  integer null,
  watched_episodes integer null,
  rating       integer null check (rating between 1 and 5),
  updated_at   timestamptz not null default now(),
  primary key (movie_id, watchlist_id)
);

create index if not exists idx_watchlists_owner_id on public.watchlists(owner_id);
create index if not exists idx_movies_created_by on public.movies(created_by);
create index if not exists idx_watchlist_movies_movie_id on public.watchlist_movies(movie_id);
create index if not exists idx_watchlist_shares_user_id on public.watchlist_shares(user_id);
create index if not exists idx_watchlist_invites_user_id on public.watchlist_share_invitations(user_id);
create index if not exists idx_movie_progress_watchlist on public.movie_progress(watchlist_id);

create or replace function public.is_watchlist_accessible(p_watchlist_id bigint, p_user text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.watchlists w
    where w.id = p_watchlist_id
      and (
        w.owner_id = p_user
        or exists (select 1 from public.watchlist_shares s where s.watchlist_id = w.id and s.user_id = p_user)
        or exists (select 1 from public.watchlist_share_invitations i where i.watchlist_id = w.id and i.user_id = p_user)
      )
  );
$$;

create or replace function public.ensure_profile(p_user_id text, p_username text)
returns void
language plpgsql
as $$
begin
  if p_user_id is null or p_user_id = '' then
    raise exception 'Invalid user id';
  end if;

  insert into public.profiles(id, username)
  values (p_user_id, left(coalesce(nullif(trim(p_username), ''), p_user_id), 50))
  on conflict (id) do nothing;
end;
$$;

create or replace function public.add_movie_to_watchlist(
  p_watchlist_id bigint,
  p_title text,
  p_media_type text default null,
  p_tmdb_id integer default null,
  p_runtime integer default null,
  p_number_of_episodes integer default null,
  p_user text default null
)
returns bigint
language plpgsql
as $$
declare
  v_movie_id bigint;
begin
  if p_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_watchlist_accessible(p_watchlist_id, p_user) then
    raise exception 'Access denied';
  end if;

  if p_media_type is not null and p_tmdb_id is not null then
    select m.id into v_movie_id
    from public.movies m
    where m.media_type = p_media_type and m.tmdb_id = p_tmdb_id;
  else
    select m.id into v_movie_id
    from public.movies m
    where lower(m.title) = lower(trim(p_title))
    order by m.id desc
    limit 1;
  end if;

  if v_movie_id is null then
    insert into public.movies(title, media_type, tmdb_id, runtime, number_of_episodes, created_by)
    values (left(trim(p_title), 120), p_media_type, p_tmdb_id, p_runtime, p_number_of_episodes, p_user)
    returning id into v_movie_id;
  end if;

  insert into public.watchlist_movies(watchlist_id, movie_id)
  values (p_watchlist_id, v_movie_id)
  on conflict do nothing;

  return v_movie_id;
end;
$$;

create or replace function public.invite_user_by_username(p_watchlist_id bigint, p_username text, p_owner text)
returns void
language plpgsql
as $$
declare
  v_target text;
begin
  if p_owner is null then
    raise exception 'Not authenticated';
  end if;

  if not exists(select 1 from public.watchlists w where w.id = p_watchlist_id and w.owner_id = p_owner) then
    raise exception 'Only owner can invite';
  end if;

  select id into v_target from public.profiles where lower(username) = lower(trim(p_username));
  if v_target is null then
    raise exception 'User not found';
  end if;

  if v_target = p_owner then
    raise exception 'Cannot invite yourself';
  end if;

  if exists(select 1 from public.watchlist_shares s where s.watchlist_id = p_watchlist_id and s.user_id = v_target) then
    return;
  end if;

  insert into public.watchlist_share_invitations(watchlist_id, user_id)
  values (p_watchlist_id, v_target)
  on conflict do nothing;
end;
$$;

create or replace function public.accept_invitation(p_watchlist_id bigint, p_user text)
returns void
language plpgsql
as $$
begin
  if p_user is null then
    raise exception 'Not authenticated';
  end if;

  if not exists(select 1 from public.watchlist_share_invitations i where i.watchlist_id = p_watchlist_id and i.user_id = p_user) then
    raise exception 'Invitation not found';
  end if;

  insert into public.watchlist_shares(watchlist_id, user_id)
  values (p_watchlist_id, p_user)
  on conflict do nothing;

  delete from public.watchlist_share_invitations
  where watchlist_id = p_watchlist_id and user_id = p_user;
end;
$$;

create or replace function public.decline_invitation(p_watchlist_id bigint, p_user text)
returns void
language sql
as $$
  delete from public.watchlist_share_invitations
  where watchlist_id = p_watchlist_id and user_id = p_user;
$$;

create or replace function public.delete_or_leave_watchlist(p_watchlist_id bigint, p_user text)
returns void
language plpgsql
as $$
begin
  if exists(select 1 from public.watchlists where id = p_watchlist_id and owner_id = p_user) then
    delete from public.watchlists where id = p_watchlist_id;
  else
    delete from public.watchlist_shares where watchlist_id = p_watchlist_id and user_id = p_user;
  end if;
end;
$$;

create or replace view public.v_user_watchlists as
  select
    w.id, w.name, w.owner_id, w.created_at,
    w.owner_id as user_id,
    'owner'::text as access_type,
    w.is_read_only
  from public.watchlists w
  union all
  select
    w.id, w.name, w.owner_id, w.created_at,
    s.user_id,
    'shared'::text as access_type,
    w.is_read_only
  from public.watchlists w
  join public.watchlist_shares s on s.watchlist_id = w.id
  union all
  select
    w.id, w.name, w.owner_id, w.created_at,
    i.user_id,
    'invited'::text as access_type,
    w.is_read_only
  from public.watchlists w
  join public.watchlist_share_invitations i on i.watchlist_id = w.id;
