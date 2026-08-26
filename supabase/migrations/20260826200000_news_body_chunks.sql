-- Semantic body chunks: one embedding per passage (not whole article).

create table if not exists public.news_body_chunks (
  id uuid primary key default gen_random_uuid(),
  news_item_id uuid not null references public.news_items (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (news_item_id, chunk_index)
);

create index if not exists news_body_chunks_item_idx
  on public.news_body_chunks (news_item_id);

create index if not exists news_body_chunks_created_at_idx
  on public.news_body_chunks (created_at desc);

alter table public.news_body_chunks enable row level security;

drop policy if exists "news_body_chunks_select_authenticated" on public.news_body_chunks;
create policy "news_body_chunks_select_authenticated" on public.news_body_chunks
  for select using (auth.role() = 'authenticated');

drop policy if exists "news_body_chunks_insert_authenticated" on public.news_body_chunks;
create policy "news_body_chunks_insert_authenticated" on public.news_body_chunks
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "news_body_chunks_update_authenticated" on public.news_body_chunks;
create policy "news_body_chunks_update_authenticated" on public.news_body_chunks
  for update using (auth.role() = 'authenticated');

drop policy if exists "news_body_chunks_delete_authenticated" on public.news_body_chunks;
create policy "news_body_chunks_delete_authenticated" on public.news_body_chunks
  for delete using (auth.role() = 'authenticated');

-- Semantic match over body passages, scoped to the caller's league triage.
drop function if exists public.match_news_body_chunks(vector, uuid, int, float);

create or replace function public.match_news_body_chunks(
  query_embedding vector(1536),
  league_id uuid,
  match_count int default 12,
  match_threshold float default 0.25
)
returns table (
  chunk_id uuid,
  news_item_id uuid,
  chunk_index int,
  content text,
  url_hash text,
  title text,
  snippet text,
  source text,
  published_at timestamptz,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    nbc.id as chunk_id,
    nbc.news_item_id,
    nbc.chunk_index,
    nbc.content,
    ni.url_hash,
    ni.title,
    ni.snippet,
    ni.source,
    ni.published_at,
    (1 - (nbc.embedding <=> query_embedding))::float as similarity
  from public.news_body_chunks nbc
  join public.news_items ni on ni.id = nbc.news_item_id
  join public.news_triage_state nts
    on nts.news_item_id = ni.id
   and nts.league_id = match_news_body_chunks.league_id
   and nts.user_id = auth.uid()
  where nts.status <> 'dismissed'
    and (1 - (nbc.embedding <=> query_embedding)) >= match_threshold
  order by nbc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_news_body_chunks(vector, uuid, int, float) to authenticated;
