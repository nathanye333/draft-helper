import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, userTeam } from "@/lib/league/data";
import { LeagueNav } from "@/components/league/league-nav";
import { LeagueSyncButtons } from "@/components/league/league-sync-buttons";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { TeamLink } from "@/components/league/entity-links";
import { RosterLineupTable } from "@/components/league/roster-lineup-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LeagueOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const bundle = await fetchLeagueBundle(id);
  if (!bundle) notFound();

  const mine = userTeam(bundle);
  const myRoster = mine
    ? bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id)
    : [];

  const ids = myRoster.map((r) => r.espn_player_id);
  const [{ data: pool }, { data: espnPlayers }] = await Promise.all([
    ids.length > 0
      ? supabase.from("league_player_pool").select("*").eq("league_id", id).in("espn_player_id", ids)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ids.length > 0
      ? supabase.from("espn_players").select("espn_player_id, headshot_url").in("espn_player_id", ids)
      : Promise.resolve({ data: [] as { espn_player_id: number; headshot_url: string | null }[] }),
  ]);

  const poolById = new Map((pool ?? []).map((p) => [p.espn_player_id as number, p]));
  const headshots = new Map(
    (espnPlayers ?? []).map((p) => [p.espn_player_id as number, p.headshot_url as string | null]),
  );

  const lineupPlayers = myRoster.map((r) => {
    const p = poolById.get(r.espn_player_id);
    return {
      espnPlayerId: r.espn_player_id,
      name: r.player_name,
      position: r.position,
      nflTeam: r.nfl_team,
      lineupSlot: r.lineup_slot,
      injuryStatus: r.injury_status,
      headshotUrl: headshots.get(r.espn_player_id) ?? null,
      weekProjected: (p?.week_projected as number | null) ?? null,
      weekActual: (p?.week_actual as number | null) ?? null,
      seasonProjected: (p?.season_projected as number | null) ?? null,
      seasonActual: (p?.season_actual as number | null) ?? null,
      percentOwned: (p?.percent_owned as number | null) ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{bundle.league.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {bundle.league.season} · {bundle.league.scoring}
            {bundle.league.current_week != null ? ` · Week ${bundle.league.current_week}` : ""}
          </p>
        </div>
        <LeagueSyncButtons leagueId={id} />
      </div>

      <LeagueNav leagueId={id} current="overview" />

      <div className="mb-6 grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card>
          <CardHeader className="py-3">
            <CardTitle>Standings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[...bundle.teams]
              .sort((a, b) => (b.wins - a.wins) || (b.points_for ?? 0) - (a.points_for ?? 0))
              .map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <TeamLink
                    leagueId={id}
                    espnTeamId={t.espn_team_id}
                    className={t.is_user_team ? "font-medium" : "text-sky-400"}
                  >
                    {t.name}
                  </TeamLink>
                  <span className="tabular-nums text-slate-400">
                    {t.wins}-{t.losses}-{t.ties}
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-slate-300 uppercase">
              {mine ? (
                <TeamLink leagueId={id} espnTeamId={mine.espn_team_id}>
                  {mine.name}
                </TeamLink>
              ) : (
                "Roster"
              )}
            </h2>
            <span className="text-xs text-slate-500">QB → RB → WR → TE → FLEX → D/ST → K → Bench</span>
          </div>
          <RosterLineupTable
            leagueId={id}
            currentWeek={bundle.league.current_week}
            players={lineupPlayers}
            emptyMessage="No roster yet — sync ESPN."
          />
        </div>
      </div>

      {!bundle.hasCredentials ? (
        <p className="mt-4 text-sm text-amber-400">
          ESPN credentials missing — reconnect from Connect ESPN.
        </p>
      ) : null}

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
