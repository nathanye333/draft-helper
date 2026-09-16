-- Ability catalog: sleep proposes workflows (auto-accept into skill on gate pass)
-- and tool/schema abilities (human approve on /admin).

create table if not exists public.agent_abilities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('season')),
  slug text not null,
  title text not null,
  description text not null default '',
  ability_kind text not null check (ability_kind in ('workflow', 'tool', 'schema')),
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'approved', 'rejected', 'implemented')),
  skill_bullet text,
  spec_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  source_sleep_at timestamptz,
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz not null default now(),
  unique (kind, slug)
);

create index if not exists agent_abilities_kind_status_idx
  on public.agent_abilities (kind, status, created_at desc);

create index if not exists agent_abilities_ability_kind_idx
  on public.agent_abilities (ability_kind, status);

alter table public.agent_abilities enable row level security;

create policy "agent_abilities_select_auth" on public.agent_abilities
  for select to authenticated using (true);
