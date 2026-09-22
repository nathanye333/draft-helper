-- Recommendation outcome RCA: skill_gap | chance | lack_of_information

alter table public.agent_recommendations
  add column if not exists rca_category text
    check (
      rca_category is null
      or rca_category in ('skill_gap', 'chance', 'lack_of_information')
    );

alter table public.agent_recommendations
  add column if not exists rca_notes text;

alter table public.agent_recommendations
  add column if not exists rca_json jsonb not null default '{}'::jsonb;

create index if not exists agent_recommendations_rca_category_idx
  on public.agent_recommendations (rca_category)
  where rca_category is not null;

create index if not exists agent_recommendations_pending_week_idx
  on public.agent_recommendations (status, week, season)
  where status in ('pending', 'awaiting_outcome', 'awaiting_sync');
