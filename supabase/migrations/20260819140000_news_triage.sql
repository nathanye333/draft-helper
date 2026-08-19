-- News triage: persisted items, per-user triage state, injury deltas, watchlist.

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  url_hash text not null unique,
  url text not null,
  title text not null,
  snippet text,
  source text not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);

create index if not exists news_items_fetched_at_idx on public.news_items (fetched_at desc);

create table if not exists public.news_item_players (
  news_item_id uuid not null references public.news_items (id) on delete cascade,
  espn_player_id int not null,
  primary key (news_item_id, espn_player_id)
);

create index if not exists news_item_players_espn_idx on public.news_item_players (espn_player_id);

create table if not exists public.news_triage_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  news_item_id uuid not null references public.news_items (id) on delete cascade,
  status text not null check (status in ('new', 'read', 'dismissed', 'actioned')),
  updated_at timestamptz not null default now(),
  unique (user_id, league_id, news_item_id)
);

create index if not exists news_triage_state_league_user_idx
  on public.news_triage_state (league_id, user_id, status);

drop trigger if exists news_triage_state_set_updated_at on public.news_triage_state;
create trigger news_triage_state_set_updated_at
  before update on public.news_triage_state
  for each row execute function public.set_updated_at();

create table if not exists public.league_injury_deltas (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  espn_player_id int not null,
  player_name text not null,
  from_status text,
  to_status text not null,
  detected_at timestamptz not null default now(),
  acknowledged boolean not null default false
);

create index if not exists league_injury_deltas_league_idx
  on public.league_injury_deltas (league_id, acknowledged, detected_at desc);

create table if not exists public.league_watchlist (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  espn_player_id int not null,
  player_name text not null,
  created_at timestamptz not null default now(),
  unique (league_id, user_id, espn_player_id)
);

create index if not exists league_watchlist_league_user_idx
  on public.league_watchlist (league_id, user_id);

-- RLS
alter table public.news_items enable row level security;
alter table public.news_item_players enable row level security;
alter table public.news_triage_state enable row level security;
alter table public.league_injury_deltas enable row level security;
alter table public.league_watchlist enable row level security;

-- news_items: readable by authenticated users; writes via authenticated upsert on fetch
create policy "news_items_select_authenticated" on public.news_items
  for select using (auth.role() = 'authenticated');
create policy "news_items_insert_authenticated" on public.news_items
  for insert with check (auth.role() = 'authenticated');
create policy "news_items_update_authenticated" on public.news_items
  for update using (auth.role() = 'authenticated');

create policy "news_item_players_select_authenticated" on public.news_item_players
  for select using (auth.role() = 'authenticated');
create policy "news_item_players_insert_authenticated" on public.news_item_players
  for insert with check (auth.role() = 'authenticated');

create policy "news_triage_state_select_own" on public.news_triage_state
  for select using (auth.uid() = user_id);
create policy "news_triage_state_insert_own" on public.news_triage_state
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.leagues l where l.id = news_triage_state.league_id and l.user_id = auth.uid())
  );
create policy "news_triage_state_update_own" on public.news_triage_state
  for update using (auth.uid() = user_id);
create policy "news_triage_state_delete_own" on public.news_triage_state
  for delete using (auth.uid() = user_id);

create policy "league_injury_deltas_select_own" on public.league_injury_deltas
  for select using (
    exists (select 1 from public.leagues l where l.id = league_injury_deltas.league_id and l.user_id = auth.uid())
  );
create policy "league_injury_deltas_insert_own" on public.league_injury_deltas
  for insert with check (
    exists (select 1 from public.leagues l where l.id = league_injury_deltas.league_id and l.user_id = auth.uid())
  );
create policy "league_injury_deltas_update_own" on public.league_injury_deltas
  for update using (
    exists (select 1 from public.leagues l where l.id = league_injury_deltas.league_id and l.user_id = auth.uid())
  );

create policy "league_watchlist_all_own" on public.league_watchlist
  for all using (
    auth.uid() = user_id
    and exists (select 1 from public.leagues l where l.id = league_watchlist.league_id and l.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.leagues l where l.id = league_watchlist.league_id and l.user_id = auth.uid())
  );
