-- Season agent self-improvement: metrics, feedback, recommendation ledger, skills.

-- ---------------------------------------------------------------------------
-- agent_skills (versioned season skill documents)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('season')),
  version int not null check (version >= 1),
  content text not null,
  status text not null default 'candidate'
    check (status in ('candidate', 'active', 'rejected')),
  metrics_json jsonb not null default '{}'::jsonb,
  parent_version int,
  created_at timestamptz not null default now(),
  unique (kind, version)
);

create unique index if not exists agent_skills_one_active_per_kind
  on public.agent_skills (kind)
  where status = 'active';

create index if not exists agent_skills_kind_status_idx
  on public.agent_skills (kind, status);

-- ---------------------------------------------------------------------------
-- agent_skill_edit_log (SkillOpt rejected buffer + gate history)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_skill_edit_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('season')),
  from_version int,
  to_version int,
  proposed_ops jsonb not null default '[]'::jsonb,
  gate_score_before numeric,
  gate_score_after numeric,
  accepted boolean not null default false,
  reject_reason text,
  evidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_skill_edit_log_kind_created_idx
  on public.agent_skill_edit_log (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- agent_turn_metrics (season chat turns)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_turn_metrics (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.league_agent_messages (id) on delete cascade,
  session_id uuid not null references public.league_agent_sessions (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_kind text not null default 'season' check (agent_kind in ('season')),
  latency_ms int,
  ttft_ms int,
  tool_count int not null default 0,
  tool_latency_ms int,
  tool_error_count int not null default 0,
  model text,
  provider text,
  skill_version int,
  follow_up_required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (message_id)
);

create index if not exists agent_turn_metrics_league_created_idx
  on public.agent_turn_metrics (league_id, created_at desc);
create index if not exists agent_turn_metrics_skill_idx
  on public.agent_turn_metrics (skill_version);

-- ---------------------------------------------------------------------------
-- agent_message_feedback (thumbs on season assistant messages)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.league_agent_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id, user_id)
);

drop trigger if exists agent_message_feedback_set_updated_at on public.agent_message_feedback;
create trigger agent_message_feedback_set_updated_at
  before update on public.agent_message_feedback
  for each row execute function public.set_updated_at();

create index if not exists agent_message_feedback_message_idx
  on public.agent_message_feedback (message_id);

-- ---------------------------------------------------------------------------
-- agent_recommendations (structured claims + delayed outcomes)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_recommendations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  agent_kind text not null default 'season' check (agent_kind in ('season')),
  claim_type text not null check (claim_type in ('start_sit', 'waiver', 'trade')),
  week int,
  season int,
  player_ids jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  rationale_summary text,
  source_message_id uuid references public.league_agent_messages (id) on delete set null,
  skill_version int,
  status text not null default 'pending'
    check (status in (
      'pending',
      'awaiting_outcome',
      'awaiting_sync',
      'validated',
      'invalidated',
      'expired',
      'inconclusive'
    )),
  outcome_score numeric,
  outcome_notes text,
  failure_tags jsonb not null default '[]'::jsonb,
  truth_source text check (
    truth_source is null
    or truth_source in ('espn_full', 'espn_light', 'nflverse', 'manual')
  ),
  data_as_of timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists agent_recommendations_league_status_idx
  on public.agent_recommendations (league_id, status);
create index if not exists agent_recommendations_status_week_idx
  on public.agent_recommendations (status, week);

-- ---------------------------------------------------------------------------
-- agent_skill_eval_runs (held-out gate results)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_skill_eval_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('season')),
  skill_version int not null,
  composite_score numeric not null,
  metrics_json jsonb not null default '{}'::jsonb,
  fixture_results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_skill_eval_runs_kind_created_idx
  on public.agent_skill_eval_runs (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.agent_skills enable row level security;
alter table public.agent_skill_edit_log enable row level security;
alter table public.agent_turn_metrics enable row level security;
alter table public.agent_message_feedback enable row level security;
alter table public.agent_recommendations enable row level security;
alter table public.agent_skill_eval_runs enable row level security;

-- Skills / edit log / eval runs: readable by authenticated users; writes via service role.
create policy "agent_skills_select_auth" on public.agent_skills
  for select to authenticated using (true);

create policy "agent_skill_edit_log_select_auth" on public.agent_skill_edit_log
  for select to authenticated using (true);

create policy "agent_skill_eval_runs_select_auth" on public.agent_skill_eval_runs
  for select to authenticated using (true);

create policy "agent_turn_metrics_select_own" on public.agent_turn_metrics
  for select to authenticated using (user_id = auth.uid());

create policy "agent_turn_metrics_insert_own" on public.agent_turn_metrics
  for insert to authenticated with check (user_id = auth.uid());

create policy "agent_message_feedback_select_own" on public.agent_message_feedback
  for select to authenticated using (user_id = auth.uid());

create policy "agent_message_feedback_insert_own" on public.agent_message_feedback
  for insert to authenticated with check (user_id = auth.uid());

create policy "agent_message_feedback_update_own" on public.agent_message_feedback
  for update to authenticated using (user_id = auth.uid());

create policy "agent_recommendations_select_own" on public.agent_recommendations
  for select to authenticated
  using (
    exists (
      select 1 from public.leagues l
      where l.id = agent_recommendations.league_id and l.user_id = auth.uid()
    )
  );

create policy "agent_recommendations_insert_own" on public.agent_recommendations
  for insert to authenticated
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = agent_recommendations.league_id and l.user_id = auth.uid()
    )
  );
