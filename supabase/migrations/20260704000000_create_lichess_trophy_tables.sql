create extension if not exists pgcrypto;

create table if not exists public.people (
  username text primary key,
  title text not null default '',
  display_name text not null default '',
  flair text not null default '',
  click_href text not null default '/player/top/blitz',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trophies (
  id uuid primary key default gen_random_uuid(),
  username text not null references public.people(username) on delete cascade,
  url text not null,
  click_url text not null default '/player/top/blitz',
  title text not null default 'Top Blitz Player',
  class_name text not null default 'trophy perf top1',
  content text not null default '',
  offset_x integer not null default 0,
  offset_y integer not null default 0,
  scale numeric not null default 1,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trophies_username_sort_order_idx
  on public.trophies (username, sort_order, created_at);

create table if not exists public.teams (
  slug text primary key,
  name text not null,
  click_href text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.team_badges (
  id uuid primary key default gen_random_uuid(),
  team_slug text not null references public.teams(slug) on delete cascade,
  url text not null,
  click_url text not null default '',
  title text not null default 'Team badge',
  class_name text not null default 'trophy perf top1',
  content text not null default '',
  offset_x integer not null default 0,
  offset_y integer not null default 0,
  scale numeric not null default 1,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_badges_team_slug_sort_order_idx
  on public.team_badges (team_slug, sort_order, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_people_updated_at on public.people;
create trigger set_people_updated_at
before update on public.people
for each row execute function public.set_updated_at();

drop trigger if exists set_trophies_updated_at on public.trophies;
create trigger set_trophies_updated_at
before update on public.trophies
for each row execute function public.set_updated_at();

drop trigger if exists set_teams_updated_at on public.teams;
create trigger set_teams_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

drop trigger if exists set_team_badges_updated_at on public.team_badges;
create trigger set_team_badges_updated_at
before update on public.team_badges
for each row execute function public.set_updated_at();

alter table public.people enable row level security;
alter table public.trophies enable row level security;
alter table public.teams enable row level security;
alter table public.team_badges enable row level security;

drop policy if exists "Public read people" on public.people;
create policy "Public read people"
  on public.people
  for select
  using (true);

drop policy if exists "Public read trophies" on public.trophies;
create policy "Public read trophies"
  on public.trophies
  for select
  using (true);

drop policy if exists "Public read teams" on public.teams;
create policy "Public read teams"
  on public.teams
  for select
  using (true);

drop policy if exists "Public read team badges" on public.team_badges;
create policy "Public read team badges"
  on public.team_badges
  for select
  using (true);

create or replace view public.people_export
with (security_invoker = true)
as
select
  p.username,
  p.title,
  p.display_name as "displayName",
  p.flair,
  p.click_href as "clickHref",
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'url', t.url,
        'clickUrl', t.click_url,
        'title', t.title,
        'className', t.class_name,
        'content', t.content,
        'offsetX', t.offset_x,
        'offsetY', t.offset_y,
        'scale', t.scale
      )
      order by t.sort_order, t.created_at
    ) filter (where t.id is not null),
    '[]'::jsonb
  ) as trophies
from public.people p
left join public.trophies t
  on t.username = p.username
group by p.username, p.title, p.display_name, p.flair, p.click_href;

create or replace view public.teams_export
with (security_invoker = true)
as
select
  tm.slug as team,
  tm.name,
  tm.click_href as "clickHref",
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'url', b.url,
        'clickUrl', b.click_url,
        'title', b.title,
        'className', b.class_name,
        'content', b.content,
        'offsetX', b.offset_x,
        'offsetY', b.offset_y,
        'scale', b.scale
      )
      order by b.sort_order, b.created_at
    ) filter (where b.id is not null),
    '[]'::jsonb
  ) as badges
from public.teams tm
left join public.team_badges b
  on b.team_slug = tm.slug
group by tm.slug, tm.name, tm.click_href;
