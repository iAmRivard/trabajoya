create table if not exists public.job_vacancies (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  provider text not null,
  title text not null,
  company text,
  area text,
  description text,
  employment_type text,
  modality text,
  country text not null default 'El Salvador',
  department text,
  municipality text,
  location_text text,
  salary_min numeric(10, 2),
  salary_max numeric(10, 2),
  currency text not null default 'USD',
  schedule text,
  posted_at date,
  expires_at date,
  experience_level text,
  education_level text,
  requirements jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  benefits jsonb not null default '[]'::jsonb,
  source_url text,
  apply_url text,
  status text not null default 'active',
  raw jsonb not null default '{}'::jsonb,
  content_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists job_vacancies_source_idx
  on public.job_vacancies (source);

create index if not exists job_vacancies_status_idx
  on public.job_vacancies (status);

create index if not exists job_vacancies_provider_idx
  on public.job_vacancies (provider);

create index if not exists job_vacancies_company_idx
  on public.job_vacancies (company);

create index if not exists job_vacancies_location_idx
  on public.job_vacancies (department, municipality);

create index if not exists job_vacancies_last_seen_at_idx
  on public.job_vacancies (last_seen_at desc);

create index if not exists job_vacancies_skills_gin_idx
  on public.job_vacancies using gin (skills);

drop trigger if exists job_vacancies_set_updated_at on public.job_vacancies;

create trigger job_vacancies_set_updated_at
before update on public.job_vacancies
for each row
execute function public.set_updated_at();
