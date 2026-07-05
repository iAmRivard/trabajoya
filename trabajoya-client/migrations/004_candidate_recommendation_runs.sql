create table if not exists public.candidate_recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid references public.candidate_intakes(id),
  profile_id uuid not null references public.candidate_profiles(id),
  requested_by text not null,
  status text not null,
  source_mode text not null default 'live',
  model text,
  profile_snapshot jsonb not null default '{}'::jsonb,
  search_queries jsonb not null default '{}'::jsonb,
  candidates jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_recommendation_runs_requested_by_check
    check (requested_by in ('candidate', 'admin')),
  constraint candidate_recommendation_runs_status_check
    check (status in ('success', 'failed')),
  constraint candidate_recommendation_runs_source_mode_check
    check (source_mode in ('live'))
);

create index if not exists candidate_recommendation_runs_intake_idx
  on public.candidate_recommendation_runs (intake_id, created_at desc);

create index if not exists candidate_recommendation_runs_profile_idx
  on public.candidate_recommendation_runs (profile_id, created_at desc);

create index if not exists candidate_recommendation_runs_status_idx
  on public.candidate_recommendation_runs (status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidate_recommendation_runs_set_updated_at
  on public.candidate_recommendation_runs;

create trigger candidate_recommendation_runs_set_updated_at
before update on public.candidate_recommendation_runs
for each row
execute function public.set_updated_at();
