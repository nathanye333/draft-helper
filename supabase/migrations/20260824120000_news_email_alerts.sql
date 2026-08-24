-- News email alerts: per-league prefs + send dedupe log.

create table if not exists public.league_news_email_prefs (
  league_id uuid primary key references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  digest_enabled boolean not null default false,
  instant_enabled boolean not null default false,
  digest_hour_utc smallint not null default 13
    check (digest_hour_utc between 0 and 23),
  updated_at timestamptz not null default now()
);

create index if not exists league_news_email_prefs_user_idx
  on public.league_news_email_prefs (user_id);

create index if not exists league_news_email_prefs_digest_idx
  on public.league_news_email_prefs (digest_enabled, digest_hour_utc)
  where digest_enabled = true;

create index if not exists league_news_email_prefs_instant_idx
  on public.league_news_email_prefs (instant_enabled)
  where instant_enabled = true;

drop trigger if exists league_news_email_prefs_set_updated_at on public.league_news_email_prefs;
create trigger league_news_email_prefs_set_updated_at
  before update on public.league_news_email_prefs
  for each row execute function public.set_updated_at();

-- Deduplicate alerts so the same Reddit post / injury jump is emailed once.
create table if not exists public.news_alert_sends (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('digest', 'reddit_spike', 'injury_delta')),
  fingerprint text not null,
  subject text not null,
  sent_at timestamptz not null default now(),
  unique (league_id, kind, fingerprint)
);

create index if not exists news_alert_sends_league_sent_idx
  on public.news_alert_sends (league_id, sent_at desc);

alter table public.league_news_email_prefs enable row level security;
alter table public.news_alert_sends enable row level security;

create policy "league_news_email_prefs_all_own" on public.league_news_email_prefs
  for all using (
    auth.uid() = user_id
    and exists (select 1 from public.leagues l where l.id = league_news_email_prefs.league_id and l.user_id = auth.uid())
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.leagues l where l.id = league_news_email_prefs.league_id and l.user_id = auth.uid())
  );

-- Sends are written by service role / cron; users can read their own history.
create policy "news_alert_sends_select_own" on public.news_alert_sends
  for select using (auth.uid() = user_id);
