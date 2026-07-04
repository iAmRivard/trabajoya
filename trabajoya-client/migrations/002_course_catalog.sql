create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  provider text not null,
  title text not null,
  area text,
  description text,
  modality text,
  country text not null default 'El Salvador',
  department text,
  municipality text,
  is_free boolean,
  cost numeric(10, 2),
  currency text not null default 'USD',
  duration_hours integer,
  schedule text,
  start_date date,
  end_date date,
  level text,
  requirements jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  target_roles jsonb not null default '[]'::jsonb,
  certificate boolean,
  source_url text,
  status text not null default 'active',
  raw jsonb not null default '{}'::jsonb,
  content_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists courses_source_idx
  on public.courses (source);

create index if not exists courses_status_idx
  on public.courses (status);

create index if not exists courses_provider_idx
  on public.courses (provider);

create index if not exists courses_last_seen_at_idx
  on public.courses (last_seen_at desc);

create index if not exists courses_skills_gin_idx
  on public.courses using gin (skills);

create table if not exists public.dataset_sync_runs (
  id uuid primary key default gen_random_uuid(),
  dataset text not null,
  source text not null,
  status text not null default 'completed',
  items_seen integer not null default 0,
  items_upserted integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);

create index if not exists dataset_sync_runs_dataset_source_idx
  on public.dataset_sync_runs (dataset, source, finished_at desc);

drop trigger if exists courses_set_updated_at on public.courses;

create trigger courses_set_updated_at
before update on public.courses
for each row
execute function public.set_updated_at();
