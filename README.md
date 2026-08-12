# Fantasy Draft Helper

A live fantasy football draft assistant. Configure your league, log picks as they
happen during a snake draft, get picks auto-assigned to roster slots, and see
every pick graded against FantasyPros consensus ADP/ECR (reach / fair / value /
steal), plus position-aware recommendations for your own team.

Built with Next.js (App Router) + Supabase (Postgres, Auth, RLS). The same
stack runs locally via the Supabase CLI and `next dev`, and deploys to
Vercel + Supabase Cloud in production.

## Tech stack

| Layer            | Choice                                             |
| ----------------- | --------------------------------------------------- |
| Framework         | Next.js 16 (App Router) + TypeScript                |
| Hosting           | Vercel                                              |
| Database / Auth   | Supabase (Postgres + Auth + Row Level Security)     |
| Styling           | Tailwind CSS + small shadcn-style UI primitives     |
| External data     | FantasyPros consensus rankings API (server-only)    |
| Tests             | Vitest (core draft/analytics logic)                 |

## Project structure

```
app/
  page.tsx                     # Dashboard: list drafts, create new
  login/                       # Magic-link sign-in
  auth/callback/               # Supabase auth code exchange
  drafts/new/                  # Setup wizard (client)
  drafts/[id]/setup/           # Rankings sync + "start draft" step
  drafts/[id]/page.tsx         # Live draft room
  drafts/[id]/board/           # Full draft board grid
  drafts/[id]/analysis/        # Reach/steal leaderboard, scarcity, recs
  api/rankings/sync/route.ts   # FantasyPros sync endpoint
  actions/draft.ts             # Server actions: createDraft, logPick, undo, ...
lib/
  supabase/                    # Browser/server/admin Supabase clients + types
  draft/                       # Snake order, slot assignment, data loading
  analytics/                   # ADP delta/reach classification, scarcity, recs
  fantasypros/                 # FantasyPros API client + sync logic
components/
  ui/                          # Button, Input, Card, Badge, Select, Label
  draft-room/, analysis/, setup-wizard/
supabase/
  migrations/                  # SQL schema + RLS policies
```

## Data model

See `supabase/migrations/20260101000000_init.sql` for the full schema:
`drafts`, `draft_teams`, `roster_slots`, `players`, `player_rankings`, and
`draft_picks`. Every draft-scoped table is protected by Row Level Security —
a user can only read/write rows belonging to drafts they own
(`auth.uid() = drafts.user_id`). The shared `players` table is
readable by any authenticated user and is only written server-side with the
service-role key (via the FantasyPros sync route).

## Core logic

- **Snake order** — `lib/draft/snake.ts`: given a pick number and team count,
  computes the round and which draft position is on the clock.
- **Slot assignment** — `lib/draft/slots.ts`: greedily fills the player's
  direct position slot, then FLEX (if RB/WR/TE), then BENCH.
- **Value grading** — `lib/analytics/value.ts`: `adp_delta = pick_number - rank_adp`,
  classified into Major Reach / Reach / Fair / Value / Major Steal.
- **Scarcity** — `lib/analytics/scarcity.ts`: compares players drafted per
  position against how many "should" be gone by now per ADP, flagging
  position runs or dead zones.
- **Recommendations** — `lib/analytics/recommendations.ts`: scores each
  available player for your team using
  `value_bonus * 0.5 + position_need * 0.3 + scarcity * 0.2`.

Run `npm test` to run the unit tests for all of the above.

## Local development

### Prerequisites

- Node.js 20+
- Docker (required by the Supabase CLI for local Postgres/Auth)

### 1. Install dependencies

```bash
npm install
```

### 2. Start Supabase locally

```bash
npx supabase start
```

This boots local Postgres, Auth, and Studio in Docker and prints your local
API URL + anon/service-role keys. Apply the schema:

```bash
npx supabase db reset
```

(`db reset` re-runs every migration in `supabase/migrations/` against the
local database — use this any time you add or change a migration.)

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` from `npx supabase status`. Add your
`FANTASYPROS_API_KEY` (see [fantasypros.com/api-data](https://www.fantasypros.com/api-data/)
to request one) — without it, rankings sync is skipped gracefully and the app
still works for manual pick logging (value badges just show "No Data").

### 4. Run the app

```bash
npm run dev
```

Visit `http://localhost:3000`, sign in with a magic link (check
`http://localhost:54324` — the local Inbucket mail viewer — for the email
when running fully offline), create a draft, and go.

### 5. Run tests / lint

```bash
npm test
npm run lint
```

## Deploying to production (Vercel + Supabase)

1. **Create a Supabase project** at [supabase.com](https://supabase.com/dashboard).
2. **Link and push migrations:**

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

3. **Create a Vercel project** from this repo and set the same environment
   variables from `.env.local.example` in Vercel's Project Settings →
   Environment Variables, using your Supabase Cloud project's URL/keys
   (Settings → API in the Supabase dashboard) and your FantasyPros API key.
4. **Enable email auth** in Supabase Auth settings (magic link is enabled by
   default) and add your production domain to the redirect URL allow-list
   (Authentication → URL Configuration).
5. Deploy. Local and production run the identical schema and code path —
   only the env vars differ.

> This repository does not include committed Supabase/Vercel credentials.
> To provision these for you automatically in future runs, add
> `SUPABASE_ACCESS_TOKEN` / project secrets and a Vercel token in the Cursor
> Dashboard (Cloud Agents → Secrets).

## Out of scope (v1)

- Auction drafts (schema has a `draft_type` column reserved for this)
- Multi-user collaborative draft rooms without auth
- Sleeper/ESPN live import — picks are entered manually
- Dynasty/rookie-specific rankings
- Player headshots (FantasyPros image licensing)
