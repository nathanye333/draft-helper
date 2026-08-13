-- NFL draft / rookie class year for players (null for DST and unmatched).
alter table public.players
  add column if not exists draft_year int;

create index if not exists players_draft_year_idx
  on public.players (draft_year);
