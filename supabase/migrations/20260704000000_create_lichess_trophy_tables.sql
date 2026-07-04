create table if not exists public.files (
  file_name text primary key,
  data jsonb not null,
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

drop trigger if exists set_files_updated_at on public.files;
create trigger set_files_updated_at
before update on public.files
for each row execute function public.set_updated_at();

alter table public.files enable row level security;

drop policy if exists "Public read files" on public.files;
create policy "Public read files"
  on public.files
  for select
  using (true);
