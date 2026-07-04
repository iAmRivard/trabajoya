create extension if not exists pgcrypto;

create table if not exists public.candidate_intakes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  phone_e164 text not null,
  phone_last4 text not null,
  full_name text,
  email text,
  municipality text,
  department text,
  desired_role text,
  source text not null default 'manual',
  status text not null default 'pending',
  initial_data jsonb not null default '{}'::jsonb,
  profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  completed_at timestamptz
);

alter table public.candidate_profiles
  add column if not exists intake_id uuid references public.candidate_intakes(id);

create index if not exists candidate_intakes_phone_e164_idx
  on public.candidate_intakes (phone_e164);

create index if not exists candidate_intakes_created_at_idx
  on public.candidate_intakes (created_at desc);

create index if not exists candidate_profiles_intake_id_idx
  on public.candidate_profiles (intake_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists candidate_intakes_set_updated_at on public.candidate_intakes;

create trigger candidate_intakes_set_updated_at
before update on public.candidate_intakes
for each row
execute function public.set_updated_at();

alter table public.candidate_intakes
  drop constraint if exists candidate_intakes_profile_id_fkey;

alter table public.candidate_intakes
  add constraint candidate_intakes_profile_id_fkey
  foreign key (profile_id) references public.candidate_profiles(id);
