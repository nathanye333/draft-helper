-- Season Advisor: ESPN-synced leagues, rosters, ID map, weekly/ROS projections.
-- Draft tables are unchanged.

-- ---------------------------------------------------------------------------
-- leagues
-- ---------------------------------------------------------------------------
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  season int not null,
  source text not null default 'espn' check (source in ('espn')),
  scoring text not null default 'PPR' check (scoring in ('STD', 'PPR', 'HALF')),
  espn_league_id text not null,
  my_espn_team_id int,
  current_week int,
  settings jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, espn_league_id, season)
);

create index if not exists leagues_user_id_idx on public.leagues (user_id);

drop trigger if exists leagues_set_updated_at on public.leagues;
create trigger leagues_set_updated_at
  before update on public.leagues
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- league_espn_credentials (encrypted cookie blobs; never expose to client)
-- ---------------------------------------------------------------------------
create table if not exists public.league_espn_credentials (
  league_id uuid primary key references public.leagues (id) on delete cascade,
  swid_ciphertext text not null,
  espn_s2_ciphertext text not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists league_espn_credentials_set_updated_at on public.league_espn_credentials;
create trigger league_espn_credentials_set_updated_at
  before update on public.league_espn_credentials
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- league_teams
-- ---------------------------------------------------------------------------
create table if not exists public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  espn_team_id int not null,
  name text not null,
  abbrev text,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  points_for numeric,
  points_against numeric,
  playoff_seed int,
  is_user_team boolean not null default false,
  created_at timestamptz not null default now(),
  unique (league_id, espn_team_id)
);

create index if not exists league_teams_league_id_idx on public.league_teams (league_id);

-- ---------------------------------------------------------------------------
-- league_roster_entries
-- ---------------------------------------------------------------------------
create table if not exists public.league_roster_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  espn_team_id int not null,
  espn_player_id int not null,
  player_name text not null,
  position text not null,
  nfl_team text,
  lineup_slot text not null,
  injury_status text,
  fp_player_id text references public.players (fp_player_id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (league_id, espn_player_id)
);

create index if not exists league_roster_entries_league_team_idx
  on public.league_roster_entries (league_id, espn_team_id);
create index if not exists league_roster_entries_fp_idx
  on public.league_roster_entries (fp_player_id);

drop trigger if exists league_roster_entries_set_updated_at on public.league_roster_entries;
create trigger league_roster_entries_set_updated_at
  before update on public.league_roster_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- league_matchups (current / recent week from ESPN mMatchup)
-- ---------------------------------------------------------------------------
create table if not exists public.league_matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  week int not null,
  home_espn_team_id int not null,
  away_espn_team_id int not null,
  home_points numeric,
  away_points numeric,
  unique (league_id, week, home_espn_team_id, away_espn_team_id)
);

create index if not exists league_matchups_league_week_idx
  on public.league_matchups (league_id, week);

-- ---------------------------------------------------------------------------
-- player_id_map (ESPN ↔ FantasyPros)
-- ---------------------------------------------------------------------------
create table if not exists public.player_id_map (
  espn_player_id int primary key,
  fp_player_id text not null references public.players (fp_player_id) on delete cascade,
  player_name text,
  updated_at timestamptz not null default now()
);

create index if not exists player_id_map_fp_idx on public.player_id_map (fp_player_id);

-- ---------------------------------------------------------------------------
-- player_projections_weekly (week = NFL week; week 0 = season/ROS)
-- ---------------------------------------------------------------------------
create table if not exists public.player_projections_weekly (
  id uuid primary key default gen_random_uuid(),
  fp_player_id text not null references public.players (fp_player_id) on delete cascade,
  season int not null,
  week int not null check (week >= 0),
  scoring text not null check (scoring in ('STD', 'PPR', 'HALF')),
  proj_points numeric,
  proj_stats jsonb,
  synced_at timestamptz not null default now(),
  unique (fp_player_id, season, week, scoring)
);

create index if not exists player_projections_weekly_lookup_idx
  on public.player_projections_weekly (season, week, scoring, proj_points desc nulls last);

-- ---------------------------------------------------------------------------
-- league_agent_sessions / messages (season AI chat)
-- ---------------------------------------------------------------------------
create table if not exists public.league_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists league_agent_sessions_league_updated_idx
  on public.league_agent_sessions (league_id, updated_at desc);

create table if not exists public.league_agent_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.league_agent_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  reasoning text,
  tool_calls jsonb,
  stopped boolean not null default false,
  sort_order int not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, sort_order)
);

create index if not exists league_agent_messages_session_idx
  on public.league_agent_messages (session_id, sort_order);

drop trigger if exists league_agent_sessions_set_updated_at on public.league_agent_sessions;
create trigger league_agent_sessions_set_updated_at
  before update on public.league_agent_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.leagues enable row level security;
alter table public.league_espn_credentials enable row level security;
alter table public.league_teams enable row level security;
alter table public.league_roster_entries enable row level security;
alter table public.league_matchups enable row level security;
alter table public.player_id_map enable row level security;
alter table public.player_projections_weekly enable row level security;
alter table public.league_agent_sessions enable row level security;
alter table public.league_agent_messages enable row level security;

create policy "leagues_select_own" on public.leagues
  for select using (auth.uid() = user_id);
create policy "leagues_insert_own" on public.leagues
  for insert with check (auth.uid() = user_id);
create policy "leagues_update_own" on public.leagues
  for update using (auth.uid() = user_id);
create policy "leagues_delete_own" on public.leagues
  for delete using (auth.uid() = user_id);

-- Credentials: owner can insert/update/delete via league ownership; select allowed
-- so server actions can read ciphertext, but UI must never display decrypted values.
create policy "league_espn_credentials_select_own" on public.league_espn_credentials
  for select using (
    exists (select 1 from public.leagues l where l.id = league_espn_credentials.league_id and l.user_id = auth.uid())
  );
create policy "league_espn_credentials_insert_own" on public.league_espn_credentials
  for insert with check (
    exists (select 1 from public.leagues l where l.id = league_espn_credentials.league_id and l.user_id = auth.uid())
  );
create policy "league_espn_credentials_update_own" on public.league_espn_credentials
  for update using (
    exists (select 1 from public.leagues l where l.id = league_espn_credentials.league_id and l.user_id = auth.uid())
  );
create policy "league_espn_credentials_delete_own" on public.league_espn_credentials
  for delete using (
    exists (select 1 from public.leagues l where l.id = league_espn_credentials.league_id and l.user_id = auth.uid())
  );

create policy "league_teams_all_own" on public.league_teams
  for all using (
    exists (select 1 from public.leagues l where l.id = league_teams.league_id and l.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.leagues l where l.id = league_teams.league_id and l.user_id = auth.uid())
  );

create policy "league_roster_entries_all_own" on public.league_roster_entries
  for all using (
    exists (select 1 from public.leagues l where l.id = league_roster_entries.league_id and l.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.leagues l where l.id = league_roster_entries.league_id and l.user_id = auth.uid())
  );

create policy "league_matchups_all_own" on public.league_matchups
  for all using (
    exists (select 1 from public.leagues l where l.id = league_matchups.league_id and l.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.leagues l where l.id = league_matchups.league_id and l.user_id = auth.uid())
  );

-- Shared reference data: readable by authenticated users; writes via service role.
create policy "player_id_map_select_authenticated" on public.player_id_map
  for select using (auth.role() = 'authenticated');

create policy "player_projections_weekly_select_authenticated" on public.player_projections_weekly
  for select using (auth.role() = 'authenticated');

create policy "league_agent_sessions_select_own" on public.league_agent_sessions
  for select using (auth.uid() = user_id);
create policy "league_agent_sessions_insert_own" on public.league_agent_sessions
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.leagues l where l.id = league_agent_sessions.league_id and l.user_id = auth.uid())
  );
create policy "league_agent_sessions_update_own" on public.league_agent_sessions
  for update using (auth.uid() = user_id);
create policy "league_agent_sessions_delete_own" on public.league_agent_sessions
  for delete using (auth.uid() = user_id);

create policy "league_agent_messages_select_own" on public.league_agent_messages
  for select using (
    exists (
      select 1 from public.league_agent_sessions s
      where s.id = league_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
create policy "league_agent_messages_insert_own" on public.league_agent_messages
  for insert with check (
    exists (
      select 1 from public.league_agent_sessions s
      where s.id = league_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
create policy "league_agent_messages_update_own" on public.league_agent_messages
  for update using (
    exists (
      select 1 from public.league_agent_sessions s
      where s.id = league_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
create policy "league_agent_messages_delete_own" on public.league_agent_messages
  for delete using (
    exists (
      select 1 from public.league_agent_sessions s
      where s.id = league_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
