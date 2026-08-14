-- Persisted draft-agent chat sessions per draft (owner-scoped via RLS).

create table if not exists public.draft_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists draft_agent_sessions_draft_updated_idx
  on public.draft_agent_sessions (draft_id, updated_at desc);

create index if not exists draft_agent_sessions_user_idx
  on public.draft_agent_sessions (user_id);

create table if not exists public.draft_agent_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.draft_agent_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  reasoning text,
  tool_calls jsonb,
  stopped boolean not null default false,
  sort_order int not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, sort_order)
);

create index if not exists draft_agent_messages_session_idx
  on public.draft_agent_messages (session_id, sort_order);

drop trigger if exists draft_agent_sessions_set_updated_at on public.draft_agent_sessions;
create trigger draft_agent_sessions_set_updated_at
  before update on public.draft_agent_sessions
  for each row execute function public.set_updated_at();

alter table public.draft_agent_sessions enable row level security;
alter table public.draft_agent_messages enable row level security;

create policy "draft_agent_sessions_select_own" on public.draft_agent_sessions
  for select using (auth.uid() = user_id);
create policy "draft_agent_sessions_insert_own" on public.draft_agent_sessions
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.drafts d
      where d.id = draft_agent_sessions.draft_id and d.user_id = auth.uid()
    )
  );
create policy "draft_agent_sessions_update_own" on public.draft_agent_sessions
  for update using (auth.uid() = user_id);
create policy "draft_agent_sessions_delete_own" on public.draft_agent_sessions
  for delete using (auth.uid() = user_id);

create policy "draft_agent_messages_select_own" on public.draft_agent_messages
  for select using (
    exists (
      select 1 from public.draft_agent_sessions s
      where s.id = draft_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
create policy "draft_agent_messages_insert_own" on public.draft_agent_messages
  for insert with check (
    exists (
      select 1 from public.draft_agent_sessions s
      where s.id = draft_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
create policy "draft_agent_messages_update_own" on public.draft_agent_messages
  for update using (
    exists (
      select 1 from public.draft_agent_sessions s
      where s.id = draft_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
create policy "draft_agent_messages_delete_own" on public.draft_agent_messages
  for delete using (
    exists (
      select 1 from public.draft_agent_sessions s
      where s.id = draft_agent_messages.session_id and s.user_id = auth.uid()
    )
  );
