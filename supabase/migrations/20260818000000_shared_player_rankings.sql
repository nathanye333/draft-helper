-- Make player_rankings a shared FantasyPros board keyed by (season, scoring),
-- usable by both drafts and season leagues (no longer draft-scoped snapshots).

alter table public.player_rankings
  add column if not exists season integer,
  add column if not exists scoring text;

update public.player_rankings pr
set
  season = d.season,
  scoring = d.scoring::text
from public.drafts d
where pr.draft_id = d.id
  and (pr.season is null or pr.scoring is null);

delete from public.player_rankings
where season is null or scoring is null;

-- Keep the newest row per shared key when drafts previously duplicated the board.
delete from public.player_rankings pr
using public.player_rankings newer
where pr.season = newer.season
  and pr.scoring = newer.scoring
  and pr.fp_player_id = newer.fp_player_id
  and (
    pr.synced_at < newer.synced_at
    or (pr.synced_at = newer.synced_at and pr.id::text < newer.id::text)
  );

-- Drop draft-scoped policy before removing draft_id (policy depends on the column).
drop policy if exists "player_rankings_select_own" on public.player_rankings;

alter table public.player_rankings
  drop constraint if exists player_rankings_draft_id_fp_player_id_key;

alter table public.player_rankings
  drop constraint if exists player_rankings_draft_id_fkey;

alter table public.player_rankings
  drop column if exists draft_id;

alter table public.player_rankings
  alter column season set not null,
  alter column scoring set not null;

alter table public.player_rankings
  drop constraint if exists player_rankings_scoring_check;

alter table public.player_rankings
  add constraint player_rankings_scoring_check
  check (scoring in ('STD', 'PPR', 'HALF'));

alter table public.player_rankings
  drop constraint if exists player_rankings_season_scoring_fp_key;

alter table public.player_rankings
  add constraint player_rankings_season_scoring_fp_key
  unique (season, scoring, fp_player_id);

drop index if exists public.player_rankings_draft_adp_idx;
drop index if exists public.player_rankings_draft_ecr_idx;
drop index if exists public.player_rankings_draft_proj_points_idx;

create index if not exists player_rankings_season_scoring_adp_idx
  on public.player_rankings (season, scoring, rank_adp);

create index if not exists player_rankings_season_scoring_ecr_idx
  on public.player_rankings (season, scoring, rank_ecr);

create index if not exists player_rankings_season_scoring_proj_points_idx
  on public.player_rankings (season, scoring, proj_points desc nulls last);

drop policy if exists "player_rankings_select_authenticated" on public.player_rankings;

create policy "player_rankings_select_authenticated" on public.player_rankings
  for select to authenticated
  using (true);
