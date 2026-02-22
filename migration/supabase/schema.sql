-- WatchList static migration schema for Supabase/Postgres
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 1 and 50),
  created_at timestamptz not null default now()
);

create table if not exists public.watchlists (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 50),
  owner_id uuid not null references public.profiles(id) on delete cascade,
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
  created_by uuid not null references public.profiles(id) on delete cascade,
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
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (watchlist_id, user_id)
);

create table if not exists public.watchlist_share_invitations (
  id bigint generated always as identity primary key,
  watchlist_id bigint not null references public.watchlists(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (watchlist_id, user_id)
);

create or replace function public.is_watchlist_accessible(p_watchlist_id bigint, p_user uuid)
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

create or replace function public.current_profile_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1), 'user');
  v_name := left(regexp_replace(v_name, '[^a-zA-Z0-9_\-]', '', 'g'), 50);

  if v_name is null or v_name = '' then
    v_name := 'user_' || substr(new.id::text, 1, 8);
  end if;

  insert into public.profiles(id, username)
  values (new.id, v_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.add_movie_to_watchlist(
  p_watchlist_id bigint,
  p_title text,
  p_media_type text default null,
  p_tmdb_id integer default null,
  p_runtime integer default null,
  p_number_of_episodes integer default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_movie_id bigint;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_watchlist_accessible(p_watchlist_id, v_user) then
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
    values (left(trim(p_title), 120), p_media_type, p_tmdb_id, p_runtime, p_number_of_episodes, v_user)
    returning id into v_movie_id;
  end if;

  insert into public.watchlist_movies(watchlist_id, movie_id)
  values (p_watchlist_id, v_movie_id)
  on conflict do nothing;

  return v_movie_id;
end;
$$;

create or replace function public.invite_user_by_username(p_watchlist_id bigint, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_target uuid;
begin
  if v_owner is null then
    raise exception 'Not authenticated';
  end if;

  if not exists(select 1 from public.watchlists w where w.id = p_watchlist_id and w.owner_id = v_owner) then
    raise exception 'Only owner can invite';
  end if;

  select id into v_target from public.profiles where lower(username) = lower(trim(p_username));
  if v_target is null then
    raise exception 'User not found';
  end if;

  if v_target = v_owner then
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

create or replace function public.accept_invitation(p_watchlist_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not exists(select 1 from public.watchlist_share_invitations i where i.watchlist_id = p_watchlist_id and i.user_id = v_user) then
    raise exception 'Invitation not found';
  end if;

  insert into public.watchlist_shares(watchlist_id, user_id)
  values (p_watchlist_id, v_user)
  on conflict do nothing;

  delete from public.watchlist_share_invitations
  where watchlist_id = p_watchlist_id and user_id = v_user;
end;
$$;

create or replace function public.decline_invitation(p_watchlist_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.watchlist_share_invitations
  where watchlist_id = p_watchlist_id and user_id = auth.uid();
$$;

alter table public.profiles enable row level security;
alter table public.watchlists enable row level security;
alter table public.movies enable row level security;
alter table public.watchlist_movies enable row level security;
alter table public.watchlist_shares enable row level security;
alter table public.watchlist_share_invitations enable row level security;

-- Profiles
create policy "profiles_select_all_authenticated"
on public.profiles
for select
using (auth.uid() is not null);

create policy "profiles_insert_self"
on public.profiles
for insert
with check (id = auth.uid());

create policy "profiles_update_self"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

-- Watchlists
create policy "watchlists_select_accessible"
on public.watchlists
for select
using (public.is_watchlist_accessible(id, auth.uid()));

create policy "watchlists_insert_owner"
on public.watchlists
for insert
with check (owner_id = auth.uid());

create policy "watchlists_update_owner"
on public.watchlists
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "watchlists_delete_owner"
on public.watchlists
for delete
using (owner_id = auth.uid());

-- Movies
create policy "movies_select_accessible"
on public.movies
for select
using (
  exists (
    select 1 from public.watchlist_movies wm
    join public.watchlists w on w.id = wm.watchlist_id
    where wm.movie_id = id and public.is_watchlist_accessible(w.id, auth.uid())
  )
);

create policy "movies_insert_authenticated"
on public.movies
for insert
with check (created_by = auth.uid());

create policy "movies_update_accessible"
on public.movies
for update
using (
  exists (
    select 1 from public.watchlist_movies wm
    join public.watchlists w on w.id = wm.watchlist_id
    where wm.movie_id = id and public.is_watchlist_accessible(w.id, auth.uid())
  )
)
with check (true);

create policy "movies_delete_owner_created"
on public.movies
for delete
using (created_by = auth.uid());

-- Watchlist movies
create policy "watchlist_movies_select_accessible"
on public.watchlist_movies
for select
using (public.is_watchlist_accessible(watchlist_id, auth.uid()));

create policy "watchlist_movies_insert_accessible"
on public.watchlist_movies
for insert
with check (public.is_watchlist_accessible(watchlist_id, auth.uid()));

create policy "watchlist_movies_delete_accessible"
on public.watchlist_movies
for delete
using (public.is_watchlist_accessible(watchlist_id, auth.uid()));

-- Shares
create policy "watchlist_shares_select_accessible"
on public.watchlist_shares
for select
using (
  exists (select 1 from public.watchlists w where w.id = watchlist_id and (w.owner_id = auth.uid() or user_id = auth.uid()))
);

create policy "watchlist_shares_insert_owner"
on public.watchlist_shares
for insert
with check (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.owner_id = auth.uid()));

create policy "watchlist_shares_delete_owner_or_self"
on public.watchlist_shares
for delete
using (
  exists (select 1 from public.watchlists w where w.id = watchlist_id and w.owner_id = auth.uid())
  or user_id = auth.uid()
);

-- Invitations
create policy "invites_select_owner_or_target"
on public.watchlist_share_invitations
for select
using (
  user_id = auth.uid()
  or exists (select 1 from public.watchlists w where w.id = watchlist_id and w.owner_id = auth.uid())
);

create policy "invites_insert_owner"
on public.watchlist_share_invitations
for insert
with check (exists (select 1 from public.watchlists w where w.id = watchlist_id and w.owner_id = auth.uid()));

create policy "invites_delete_owner_or_target"
on public.watchlist_share_invitations
for delete
using (
  user_id = auth.uid()
  or exists (select 1 from public.watchlists w where w.id = watchlist_id and w.owner_id = auth.uid())
);

-- Helpful view for app reads
create or replace view public.v_user_watchlists as
select
  w.id,
  w.name,
  w.owner_id,
  p.username as owner_username,
  case
    when w.owner_id = auth.uid() then 'owner'
    when exists(select 1 from public.watchlist_shares s where s.watchlist_id = w.id and s.user_id = auth.uid()) then 'shared'
    when exists(select 1 from public.watchlist_share_invitations i where i.watchlist_id = w.id and i.user_id = auth.uid()) then 'invited'
    else 'none'
  end as access_type,
  w.created_at
from public.watchlists w
join public.profiles p on p.id = w.owner_id
where public.is_watchlist_accessible(w.id, auth.uid());
