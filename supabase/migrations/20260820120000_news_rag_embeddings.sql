-- Richer news RAG: store article body + embeddings for semantic search.
-- Title/caption alone are too thin for accurate retrieval.

create extension if not exists vector;

alter table public.news_items
  add column if not exists body text;

-- Embeddings keyed to news_items (one vector per article).
create table if not exists public.news_embeddings (
  news_item_id uuid primary key references public.news_items (id) on delete cascade,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

-- Exact scan is fine at news-feed scale; add an ANN index later if needed.
create index if not exists news_embeddings_created_at_idx
  on public.news_embeddings (created_at desc);

alter table public.news_embeddings enable row level security;

drop policy if exists "news_embeddings_select_authenticated" on public.news_embeddings;
create policy "news_embeddings_select_authenticated" on public.news_embeddings
  for select using (auth.role() = 'authenticated');

drop policy if exists "news_embeddings_insert_authenticated" on public.news_embeddings;
create policy "news_embeddings_insert_authenticated" on public.news_embeddings
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "news_embeddings_update_authenticated" on public.news_embeddings;
create policy "news_embeddings_update_authenticated" on public.news_embeddings
  for update using (auth.role() = 'authenticated');

-- Semantic match scoped to items the user has triage state for in this league.
-- Drop first: return type may change when body is added.
drop function if exists public.match_news_embeddings(vector, uuid, int, float);

create or replace function public.match_news_embeddings(
  query_embedding vector(1536),
  league_id uuid,
  match_count int default 10,
  match_threshold float default 0.25
)
returns table (
  news_item_id uuid,
  url_hash text,
  title text,
  snippet text,
  body text,
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
    ni.id as news_item_id,
    ni.url_hash,
    ni.title,
    ni.snippet,
    ni.body,
    ni.source,
    ni.published_at,
    (1 - (ne.embedding <=> query_embedding))::float as similarity
  from public.news_embeddings ne
  join public.news_items ni on ni.id = ne.news_item_id
  join public.news_triage_state nts
    on nts.news_item_id = ni.id
   and nts.league_id = match_news_embeddings.league_id
   and nts.user_id = auth.uid()
  where nts.status <> 'dismissed'
    and (1 - (ne.embedding <=> query_embedding)) >= match_threshold
  order by ne.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_news_embeddings(vector, uuid, int, float) to authenticated;
