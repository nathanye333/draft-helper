import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, rosterSlotsFromLeague, userTeam } from "@/lib/league/data";
import { suggestStartSit } from "@/lib/analytics/start-sit";
import { LeagueNav } from "@/components/league/league-nav";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { TeamLink } from "@/components/league/entity-links";
import { RosterLineupTable, type LineupPlayerRow } from "@/components/league/roster-lineup-table";
import { LeagueSyncButtons } from "@/components/league/league-sync-buttons";

export default async function StartSitPage({
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
  const roster = mine
    ? bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id)
    : [];

  const ids = roster.map((r) => r.espn_player_id);
  const { data: pool } =
    ids.length > 0
      ? await supabase
          .from("league_player_pool")
          .select("*")
          .eq("league_id", id)
          .in("espn_player_id", ids)
      : { data: [] };
  const poolById = new Map((pool ?? []).map((p) => [p.espn_player_id as number, p]));

  const { data: espnPlayers } =
    ids.length > 0
      ? await supabase.from("espn_players").select("espn_player_id, headshot_url").in("espn_player_id", ids)
      : { data: [] };
  const headshots = new Map(
    (espnPlayers ?? []).map((p) => [p.espn_player_id as number, p.headshot_url as string | null]),
  );

  const weekProj = new Map<string, number | null>();
  for (const [fp, v] of bundle.projectionsByFpId) weekProj.set(fp, v.week);

  // Prefer ESPN week proj from pool when present.
  const espnWeekByFpOrEspn = new Map<string, number | null>();
  for (const r of roster) {
    const p = poolById.get(r.espn_player_id);
    if (p?.week_projected != null && r.fp_player_id) {
      espnWeekByFpOrEspn.set(r.fp_player_id, p.week_projected as number);
    }
  }
  const mergedWeek = new Map(weekProj);
  for (const [k, v] of espnWeekByFpOrEspn) mergedWeek.set(k, v);

  const suggestion = suggestStartSit({
    roster,
    rosterSlots: rosterSlotsFromLeague(bundle.league),
    weekProjByFpId: mergedWeek,
  });

  const opp = mine
    ? bundle.matchups.find(
        (m) =>
          m.home_espn_team_id === mine.espn_team_id ||
          m.away_espn_team_id === mine.espn_team_id,
      )
    : undefined;
  let opponentName: string | null = null;
  let opponentTeamId: number | null = null;
  if (opp && mine) {
    opponentTeamId =
      opp.home_espn_team_id === mine.espn_team_id
        ? opp.away_espn_team_id
        : opp.home_espn_team_id;
    opponentName = bundle.teams.find((t) => t.espn_team_id === opponentTeamId)?.name ?? null;
  }

  function toRow(
    espnPlayerId: number,
    lineupSlot: string,
    weekOverride?: number | null,
  ): LineupPlayerRow | null {
    const r = roster.find((x) => x.espn_player_id === espnPlayerId);
    if (!r) return null;
    const p = poolById.get(espnPlayerId);
    return {
      espnPlayerId,
      name: r.player_name,
      position: r.position,
      nflTeam: r.nfl_team,
      lineupSlot,
      injuryStatus: r.injury_status,
      headshotUrl: headshots.get(espnPlayerId) ?? null,
      weekProjected: weekOverride ?? (p?.week_projected as number | null) ?? null,
      weekActual: (p?.week_actual as number | null) ?? null,
      seasonProjected: (p?.season_projected as number | null) ?? null,
      seasonActual: (p?.season_actual as number | null) ?? null,
      percentOwned: (p?.percent_owned as number | null) ?? null,
    };
  }

  const starterRows: LineupPlayerRow[] = [];
  for (const s of suggestion.starters) {
    const row = toRow(s.espnPlayerId, s.currentSlot, s.weekProj);
    if (row) starterRows.push(row);
  }
  const benchRows: LineupPlayerRow[] = [];
  for (const b of suggestion.bench) {
    const row = toRow(b.espnPlayerId, "BENCH", b.weekProj);
    if (row) benchRows.push(row);
  }

  const lineupPlayers = [...starterRows, ...benchRows];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Start / Sit</h1>
          <p className="mt-1 text-sm text-slate-400">
            Recommended lineup · Week {bundle.league.current_week ?? "—"}
            {opponentName && opponentTeamId != null ? (
              <>
                {" "}
                vs{" "}
                <TeamLink leagueId={id} espnTeamId={opponentTeamId}>
                  {opponentName}
                </TeamLink>
              </>
            ) : null}
            {" · "}
            {suggestion.projectedStarterPoints.toFixed(1)} projected starter pts
          </p>
        </div>
        <LeagueSyncButtons leagueId={id} />
      </div>
      <LeagueNav leagueId={id} current="start-sit" />

      <RosterLineupTable
        leagueId={id}
        currentWeek={bundle.league.current_week}
        players={lineupPlayers}
        emptyMessage="Sync ESPN and projections to build a lineup."
      />

      {suggestion.notes.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-400">
          {suggestion.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
