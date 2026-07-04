create table if not exists public.people (
  username text primary key,
  title text not null default '',
  display_name text not null default '',
  flair text not null default '',
  click_href text not null default '/player/top/blitz',
  trophies jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  slug text primary key,
  name text not null,
  click_href text not null default '',
  badges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

drop trigger if exists set_teams_updated_at on public.teams;
create trigger set_teams_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

alter table public.people enable row level security;
alter table public.teams enable row level security;

drop policy if exists "Public read people" on public.people;
create policy "Public read people"
  on public.people
  for select
  using (true);

drop policy if exists "Public read teams" on public.teams;
create policy "Public read teams"
  on public.teams
  for select
  using (true);
