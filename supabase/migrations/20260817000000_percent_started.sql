-- ESPN % started (percentStarted) alongside % rostered.
alter table public.league_player_pool
  add column if not exists percent_started numeric;
