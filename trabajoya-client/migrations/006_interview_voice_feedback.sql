alter table public.candidate_interview_simulations
  add column if not exists feedback_voice_text text,
  add column if not exists feedback_voice_attempted_at timestamptz,
  add column if not exists feedback_voice_sent_at timestamptz,
  add column if not exists feedback_voice_error text;

create index if not exists candidate_interview_simulations_voice_feedback_idx
  on public.candidate_interview_simulations (feedback_voice_attempted_at, feedback_voice_sent_at);
