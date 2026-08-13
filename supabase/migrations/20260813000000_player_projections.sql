-- Cache FantasyPros season projections on per-draft rankings snapshots.
-- proj_points is scoring-aware (STD/PPR/HALF); proj_stats holds the full FP stats object.

alter table public.player_rankings
  add column if not exists proj_points numeric,
  add column if not exists proj_stats jsonb;

create index if not exists player_rankings_draft_proj_points_idx
  on public.player_rankings (draft_id, proj_points desc nulls last);
