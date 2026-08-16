-- ESPN player pool + weekly fantasy points (actual/projected), league-scoped scoring.

create table if not exists public.espn_players (
  espn_player_id int primary key,
  name text not null,
  position text not null,
  nfl_team text,
  headshot_url text,
  updated_at timestamptz not null default now()
);

drop trigger if exists espn_players_set_updated_at on public.espn_players;
create trigger espn_players_set_updated_at
  before update on public.espn_players
  for each row execute function public.set_updated_at();

-- Ownership + summary projections for this league's scoring settings.
create table if not exists public.league_player_pool (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  espn_player_id int not null references public.espn_players (espn_player_id) on delete cascade,
  ownership text not null default 'FREEAGENT'
    check (ownership in ('ONTEAM', 'WAIVERS', 'FREEAGENT')),
  espn_team_id int,
  percent_owned numeric,
  injury_status text,
  week_projected numeric,
  week_actual numeric,
  season_projected numeric,
  season_actual numeric,
  fp_player_id text references public.players (fp_player_id) on delete set null,
  synced_at timestamptz not null default now(),
  unique (league_id, espn_player_id)
);

create index if not exists league_player_pool_league_own_idx
  on public.league_player_pool (league_id, ownership);
create index if not exists league_player_pool_league_week_proj_idx
  on public.league_player_pool (league_id, week_projected desc nulls last);

-- Week-by-week fantasy points (this year + last year). week 0 = season total.
create table if not exists public.espn_player_week_points (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  espn_player_id int not null,
  season int not null,
  week int not null check (week >= 0),
  actual_points numeric,
  projected_points numeric,
  synced_at timestamptz not null default now(),
  unique (league_id, espn_player_id, season, week)
);

create index if not exists espn_player_week_points_lookup_idx
  on public.espn_player_week_points (league_id, espn_player_id, season, week);

alter table public.espn_players enable row level security;
alter table public.league_player_pool enable row level security;
alter table public.espn_player_week_points enable row level security;

create policy "espn_players_select_authenticated" on public.espn_players
  for select using (auth.role() = 'authenticated');

create policy "league_player_pool_all_own" on public.league_player_pool
  for all using (
    exists (select 1 from public.leagues l where l.id = league_player_pool.league_id and l.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.leagues l where l.id = league_player_pool.league_id and l.user_id = auth.uid())
  );

create policy "espn_player_week_points_all_own" on public.espn_player_week_points
  for all using (
    exists (select 1 from public.leagues l where l.id = espn_player_week_points.league_id and l.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.leagues l where l.id = espn_player_week_points.league_id and l.user_id = auth.uid())
  );
