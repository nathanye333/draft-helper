-- Raw weekly NFL player stats (nflverse) for free-form SQL analysis.

create table if not exists public.nfl_player_week_stats (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  week integer not null,
  season_type text not null default 'REG',
  player_id text not null,
  player_name text not null,
  position text not null,
  team text not null,
  opponent_team text not null,
  fantasy_points numeric,
  fantasy_points_ppr numeric,
  carries integer,
  rushing_yards integer,
  rushing_tds integer,
  targets integer,
  receptions integer,
  receiving_yards integer,
  receiving_tds integer,
  attempts integer,
  passing_yards integer,
  passing_tds integer,
  synced_at timestamptz not null default now(),
  unique (season, week, player_id)
);

create index if not exists nfl_player_week_stats_lookup_idx
  on public.nfl_player_week_stats (season, position, opponent_team);

create index if not exists nfl_player_week_stats_team_idx
  on public.nfl_player_week_stats (season, team, week);

alter table public.nfl_player_week_stats enable row level security;

drop policy if exists "nfl_player_week_stats_select_authenticated" on public.nfl_player_week_stats;
create policy "nfl_player_week_stats_select_authenticated" on public.nfl_player_week_stats
  for select to authenticated
  using (true);
