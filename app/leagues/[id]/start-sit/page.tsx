import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  fetchLeagueBundle,
  irSlotCountFromLeague,
  rosterSlotsFromLeague,
  userTeam,
} from "@/lib/league/data";
import { resolveEspnImageUrl } from "@/lib/espn/player-universe";
import { suggestStartSit } from "@/lib/analytics/start-sit";
import { LeagueNav } from "@/components/league/league-nav";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { TeamLink } from "@/components/league/entity-links";
import {
  StartSitBoard,
  type StartSitPlayerView,
} from "@/components/league/start-sit-board";
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
      ? await supabase
          .from("espn_players")
          .select("espn_player_id, headshot_url")
          .in("espn_player_id", ids)
      : { data: [] };
  const headshots = new Map(
    (espnPlayers ?? []).map((p) => [p.espn_player_id as number, p.headshot_url as string | null]),
  );

  const weekProj = new Map<string, number | null>();
  for (const [fp, v] of bundle.projectionsByFpId) weekProj.set(fp, v.week);

  for (const r of roster) {
    const p = poolById.get(r.espn_player_id);
    if (p?.week_projected != null && r.fp_player_id) {
      weekProj.set(r.fp_player_id, p.week_projected as number);
    }
  }

  const rosterSlots = rosterSlotsFromLeague(bundle.league);
  const suggestion = suggestStartSit({
    roster,
    rosterSlots,
    weekProjByFpId: weekProj,
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

  function toView(
    espnPlayerId: number,
    lineupSlot: string,
    weekOverride?: number | null,
  ): StartSitPlayerView | null {
    const r = roster.find((x) => x.espn_player_id === espnPlayerId);
    if (!r) return null;
    const p = poolById.get(espnPlayerId);
    const fpWeek = r.fp_player_id ? (weekProj.get(r.fp_player_id) ?? null) : null;
    return {
      espnPlayerId,
      name: r.player_name,
      position: r.position,
      nflTeam: r.nfl_team,
      lineupSlot,
      injuryStatus: r.injury_status,
      headshotUrl: resolveEspnImageUrl({
        espnPlayerId,
        position: r.position,
        nflTeam: r.nfl_team,
        storedUrl: headshots.get(espnPlayerId) ?? null,
      }),
      weekProjected: weekOverride ?? (p?.week_projected as number | null) ?? fpWeek ?? null,
      weekActual: (p?.week_actual as number | null) ?? null,
      seasonProjected: (p?.season_projected as number | null) ?? null,
      seasonActual: (p?.season_actual as number | null) ?? null,
      percentOwned: (p?.percent_owned as number | null) ?? null,
      percentStarted: (p?.percent_started as number | null) ?? null,
    };
  }

  const recommended: StartSitPlayerView[] = [];
  for (const s of suggestion.starters) {
    const row = toView(s.espnPlayerId, s.currentSlot, s.weekProj);
    if (row) recommended.push(row);
  }
  for (const b of suggestion.bench) {
    const row = toView(b.espnPlayerId, "BENCH", b.weekProj);
    if (row) recommended.push(row);
  }
  for (const r of roster.filter((x) => x.lineup_slot === "IR")) {
    const row = toView(r.espn_player_id, "IR");
    if (row) recommended.push(row);
  }

  const espnSynced: StartSitPlayerView[] = [];
  for (const r of roster) {
    const row = toView(r.espn_player_id, r.lineup_slot);
    if (row) espnSynced.push(row);
  }

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
            {irSlotCountFromLeague(bundle.league) > 0
              ? ` · ${irSlotCountFromLeague(bundle.league)} IR`
              : ""}
          </p>
        </div>
        <LeagueSyncButtons leagueId={id} />
      </div>
      <LeagueNav leagueId={id} current="start-sit" />

      <StartSitBoard
        leagueId={id}
        currentWeek={bundle.league.current_week}
        rosterSlots={rosterSlots}
        recommended={recommended}
        espnSynced={espnSynced}
        notes={suggestion.notes}
      />

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
