-- NFL defense vs position matchup board (from nflverse player weekly stats).
-- Shared reference data; readable by any authenticated user.

create table if not exists public.nfl_defense_vs_position (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  defense_team text not null,
  position text not null check (position in ('QB', 'RB', 'WR', 'TE')),
  games integer not null default 0,
  fant_pts_avg numeric,
  fant_pts_ppr_avg numeric,
  fant_pts_rank integer,
  fant_pts_ppr_rank integer,
  rush_att integer,
  rush_yds integer,
  rush_ypc numeric,
  rush_ypc_vs_avg numeric,
  pass_att integer,
  pass_yds integer,
  pass_ypa numeric,
  targets integer,
  receptions integer,
  rec_yds integer,
  synced_at timestamptz not null default now(),
  unique (season, defense_team, position)
);

create index if not exists nfl_defense_vs_position_lookup_idx
  on public.nfl_defense_vs_position (season, position, fant_pts_avg desc nulls last);

create index if not exists nfl_defense_vs_position_team_idx
  on public.nfl_defense_vs_position (season, defense_team);

-- Weekly NFL schedule for matchup context (home/away by week).
create table if not exists public.nfl_schedule_games (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  week integer not null,
  game_type text not null default 'REG',
  home_team text not null,
  away_team text not null,
  gameday date,
  synced_at timestamptz not null default now(),
  unique (season, week, home_team, away_team)
);

create index if not exists nfl_schedule_games_week_idx
  on public.nfl_schedule_games (season, week);

alter table public.nfl_defense_vs_position enable row level security;
alter table public.nfl_schedule_games enable row level security;

drop policy if exists "nfl_defense_vs_position_select_authenticated" on public.nfl_defense_vs_position;
create policy "nfl_defense_vs_position_select_authenticated" on public.nfl_defense_vs_position
  for select to authenticated
  using (true);

drop policy if exists "nfl_schedule_games_select_authenticated" on public.nfl_schedule_games;
create policy "nfl_schedule_games_select_authenticated" on public.nfl_schedule_games
  for select to authenticated
  using (true);
