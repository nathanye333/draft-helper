-- Fantasy Draft Helper: initial schema
-- Tables: drafts, draft_teams, roster_slots, players, player_rankings, draft_picks
-- All draft-scoped tables are protected by RLS keyed off drafts.user_id = auth.uid().

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- drafts
-- ---------------------------------------------------------------------------
create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  season int not null,
  num_teams int not null check (num_teams between 2 and 20),
  draft_type text not null default 'snake' check (draft_type in ('snake', 'auction')),
  scoring text not null default 'PPR' check (scoring in ('STD', 'PPR', 'HALF')),
  status text not null default 'setup' check (status in ('setup', 'live', 'complete')),
  -- FK added below (after draft_teams exists) to avoid a circular table dependency.
  my_team_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drafts_user_id_idx on public.drafts (user_id);

-- ---------------------------------------------------------------------------
-- draft_teams
-- ---------------------------------------------------------------------------
create table if not exists public.draft_teams (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  name text not null,
  draft_position int not null check (draft_position > 0),
  is_user_team boolean not null default false,
  created_at timestamptz not null default now(),
  unique (draft_id, draft_position)
);

create index if not exists draft_teams_draft_id_idx on public.draft_teams (draft_id);

alter table public.drafts
  add constraint drafts_my_team_id_fkey
  foreign key (my_team_id) references public.draft_teams (id) on delete set null;

-- ---------------------------------------------------------------------------
-- roster_slots (configurable per draft)
-- ---------------------------------------------------------------------------
create table if not exists public.roster_slots (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  slot_type text not null check (slot_type in ('QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BENCH')),
  count int not null check (count > 0),
  sort_order int not null,
  created_at timestamptz not null default now()
);

create index if not exists roster_slots_draft_id_idx on public.roster_slots (draft_id);

-- ---------------------------------------------------------------------------
-- players (master list, synced from FantasyPros; shared across all drafts)
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  fp_player_id text primary key,
  name text not null,
  position text not null,
  nfl_team text,
  bye_week int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_name_trgm_idx on public.players using gin (name gin_trgm_ops);
create index if not exists players_position_idx on public.players (position);

-- ---------------------------------------------------------------------------
-- player_rankings (snapshot per draft, frozen at setup and refreshable)
-- ---------------------------------------------------------------------------
create table if not exists public.player_rankings (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  fp_player_id text not null references public.players (fp_player_id) on delete cascade,
  rank_ecr numeric,
  rank_adp numeric,
  rank_min numeric,
  rank_max numeric,
  rank_std numeric,
  tier int,
  synced_at timestamptz not null default now(),
  unique (draft_id, fp_player_id)
);

create index if not exists player_rankings_draft_adp_idx on public.player_rankings (draft_id, rank_adp);
create index if not exists player_rankings_draft_ecr_idx on public.player_rankings (draft_id, rank_ecr);

-- ---------------------------------------------------------------------------
-- draft_picks (ordered live state)
-- ---------------------------------------------------------------------------
create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  pick_number int not null check (pick_number > 0),
  round int not null check (round > 0),
  team_id uuid not null references public.draft_teams (id) on delete cascade,
  fp_player_id text not null references public.players (fp_player_id),
  assigned_slot_type text not null check (assigned_slot_type in ('QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BENCH')),
  adp_delta numeric,
  created_at timestamptz not null default now(),
  unique (draft_id, pick_number),
  unique (draft_id, fp_player_id)
);

create index if not exists draft_picks_draft_id_pick_number_idx on public.draft_picks (draft_id, pick_number);
create index if not exists draft_picks_draft_id_team_id_idx on public.draft_picks (draft_id, team_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists drafts_set_updated_at on public.drafts;
create trigger drafts_set_updated_at
  before update on public.drafts
  for each row execute function public.set_updated_at();

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.drafts enable row level security;
alter table public.draft_teams enable row level security;
alter table public.roster_slots enable row level security;
alter table public.players enable row level security;
alter table public.player_rankings enable row level security;
alter table public.draft_picks enable row level security;

-- drafts: owner-only
create policy "drafts_select_own" on public.drafts
  for select using (auth.uid() = user_id);
create policy "drafts_insert_own" on public.drafts
  for insert with check (auth.uid() = user_id);
create policy "drafts_update_own" on public.drafts
  for update using (auth.uid() = user_id);
create policy "drafts_delete_own" on public.drafts
  for delete using (auth.uid() = user_id);

-- draft_teams: scoped via parent draft ownership
create policy "draft_teams_select_own" on public.draft_teams
  for select using (
    exists (select 1 from public.drafts d where d.id = draft_teams.draft_id and d.user_id = auth.uid())
  );
create policy "draft_teams_insert_own" on public.draft_teams
  for insert with check (
    exists (select 1 from public.drafts d where d.id = draft_teams.draft_id and d.user_id = auth.uid())
  );
create policy "draft_teams_update_own" on public.draft_teams
  for update using (
    exists (select 1 from public.drafts d where d.id = draft_teams.draft_id and d.user_id = auth.uid())
  );
create policy "draft_teams_delete_own" on public.draft_teams
  for delete using (
    exists (select 1 from public.drafts d where d.id = draft_teams.draft_id and d.user_id = auth.uid())
  );

-- roster_slots: scoped via parent draft ownership
create policy "roster_slots_select_own" on public.roster_slots
  for select using (
    exists (select 1 from public.drafts d where d.id = roster_slots.draft_id and d.user_id = auth.uid())
  );
create policy "roster_slots_insert_own" on public.roster_slots
  for insert with check (
    exists (select 1 from public.drafts d where d.id = roster_slots.draft_id and d.user_id = auth.uid())
  );
create policy "roster_slots_update_own" on public.roster_slots
  for update using (
    exists (select 1 from public.drafts d where d.id = roster_slots.draft_id and d.user_id = auth.uid())
  );
create policy "roster_slots_delete_own" on public.roster_slots
  for delete using (
    exists (select 1 from public.drafts d where d.id = roster_slots.draft_id and d.user_id = auth.uid())
  );

-- players: shared master list. Readable by any authenticated user; writes are
-- performed server-side with the service role key (which bypasses RLS), so no
-- insert/update/delete policies are defined for regular users.
create policy "players_select_authenticated" on public.players
  for select using (auth.role() = 'authenticated');

-- player_rankings: scoped via parent draft ownership (read-only for users; writes
-- happen server-side via the FantasyPros sync route using the service role key).
create policy "player_rankings_select_own" on public.player_rankings
  for select using (
    exists (select 1 from public.drafts d where d.id = player_rankings.draft_id and d.user_id = auth.uid())
  );

-- draft_picks: scoped via parent draft ownership
create policy "draft_picks_select_own" on public.draft_picks
  for select using (
    exists (select 1 from public.drafts d where d.id = draft_picks.draft_id and d.user_id = auth.uid())
  );
create policy "draft_picks_insert_own" on public.draft_picks
  for insert with check (
    exists (select 1 from public.drafts d where d.id = draft_picks.draft_id and d.user_id = auth.uid())
  );
create policy "draft_picks_update_own" on public.draft_picks
  for update using (
    exists (select 1 from public.drafts d where d.id = draft_picks.draft_id and d.user_id = auth.uid())
  );
create policy "draft_picks_delete_own" on public.draft_picks
  for delete using (
    exists (select 1 from public.drafts d where d.id = draft_picks.draft_id and d.user_id = auth.uid())
  );
