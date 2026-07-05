create table if not exists public.candidate_interview_simulations (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.candidate_intakes(id),
  profile_id uuid not null references public.candidate_profiles(id),
  recommendation_run_id uuid references public.candidate_recommendation_runs(id),
  job_vacancy_id uuid references public.job_vacancies(id),
  selected_job jsonb not null default '{}'::jsonb,
  profile_snapshot jsonb not null default '{}'::jsonb,
  agent_id text,
  elevenlabs_conversation_id text,
  status text not null default 'started',
  feedback jsonb not null default '{}'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint candidate_interview_simulations_status_check
    check (status in ('started', 'completed', 'failed'))
);

create index if not exists candidate_interview_simulations_intake_idx
  on public.candidate_interview_simulations (intake_id, created_at desc);

create index if not exists candidate_interview_simulations_profile_idx
  on public.candidate_interview_simulations (profile_id, created_at desc);

create index if not exists candidate_interview_simulations_job_idx
  on public.candidate_interview_simulations (job_vacancy_id, created_at desc);

create index if not exists candidate_interview_simulations_status_idx
  on public.candidate_interview_simulations (status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidate_interview_simulations_set_updated_at
  on public.candidate_interview_simulations;

create trigger candidate_interview_simulations_set_updated_at
before update on public.candidate_interview_simulations
for each row
execute function public.set_updated_at();
