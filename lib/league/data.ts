import { createClient } from "@/lib/supabase/server";
import type {
  League,
  LeagueMatchup,
  LeagueRosterEntry,
  LeagueSettings,
  LeagueTeam,
  PlayerProjectionWeekly,
  ScoringFormat,
  SlotType,
} from "@/lib/supabase/types";

export interface LeagueBundle {
  league: League;
  teams: LeagueTeam[];
  rosterEntries: LeagueRosterEntry[];
  matchups: LeagueMatchup[];
  projectionsByFpId: Map<string, { week: number | null; ros: number | null }>;
  hasCredentials: boolean;
}

export async function fetchLeagueBundle(leagueId: string): Promise<LeagueBundle | null> {
  const supabase = await createClient();

  const { data: league, error } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();

  if (error || !league) return null;

  const [
    { data: teams },
    { data: rosterEntries },
    { data: matchups },
    { data: creds },
  ] = await Promise.all([
    supabase.from("league_teams").select("*").eq("league_id", leagueId).order("espn_team_id"),
    supabase.from("league_roster_entries").select("*").eq("league_id", leagueId),
    supabase.from("league_matchups").select("*").eq("league_id", leagueId),
    supabase.from("league_espn_credentials").select("league_id").eq("league_id", leagueId).maybeSingle(),
  ]);

  const typedLeague = league as League;
  const week = typedLeague.current_week && typedLeague.current_week > 0 ? typedLeague.current_week : null;
  const scoring = typedLeague.scoring as ScoringFormat;

  const fpIds = [
    ...new Set(
      (rosterEntries ?? [])
        .map((r) => r.fp_player_id as string | null)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const projectionsByFpId = new Map<string, { week: number | null; ros: number | null }>();

  if (fpIds.length > 0) {
    const weeks = week != null ? [0, week] : [0];
    const { data: projs } = await supabase
      .from("player_projections_weekly")
      .select("fp_player_id, week, proj_points")
      .eq("season", typedLeague.season)
      .eq("scoring", scoring)
      .in("week", weeks)
      .in("fp_player_id", fpIds);

    for (const p of (projs ?? []) as Pick<PlayerProjectionWeekly, "fp_player_id" | "week" | "proj_points">[]) {
      const cur = projectionsByFpId.get(p.fp_player_id) ?? { week: null, ros: null };
      if (p.week === 0) cur.ros = p.proj_points;
      else if (week != null && p.week === week) cur.week = p.proj_points;
      projectionsByFpId.set(p.fp_player_id, cur);
    }
  }

  return {
    league: {
      ...typedLeague,
      settings: (typedLeague.settings ?? {}) as LeagueSettings,
    },
    teams: (teams ?? []) as LeagueTeam[],
    rosterEntries: (rosterEntries ?? []) as LeagueRosterEntry[],
    matchups: (matchups ?? []) as LeagueMatchup[],
    projectionsByFpId,
    hasCredentials: Boolean(creds),
  };
}

export function rosterSlotsFromLeague(league: League): { slot_type: SlotType; count: number }[] {
  const slots = league.settings?.rosterSlots;
  if (Array.isArray(slots) && slots.length > 0) return slots;
  return [
    { slot_type: "QB", count: 1 },
    { slot_type: "RB", count: 2 },
    { slot_type: "WR", count: 2 },
    { slot_type: "TE", count: 1 },
    { slot_type: "FLEX", count: 1 },
    { slot_type: "DST", count: 1 },
    { slot_type: "K", count: 1 },
    { slot_type: "BENCH", count: 6 },
  ];
}

export function userTeam(bundle: LeagueBundle): LeagueTeam | undefined {
  return (
    bundle.teams.find((t) => t.is_user_team) ??
    bundle.teams.find((t) => t.espn_team_id === bundle.league.my_espn_team_id)
  );
}

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FreeAgentRow {
  fpPlayerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  /** FantasyPros projected points for `projectionWeek` (null if unavailable). */
  weekProj: number | null;
  /** FantasyPros rest-of-season / season-long points (week=0 in our cache). */
  rosProj: number | null;
  /** NFL week number used for weekProj; null when only ROS is available. */
  projectionWeek: number | null;
  source: "fantasypros";
}

/**
 * Players not on any ESPN roster in this league, ranked by FantasyPros
 * weekly (preferred) then ROS projections. Excludes rostered players by
 * FP id, ESPN→FP map, and normalized name (covers failed ID maps).
 */
export async function fetchFreeAgents(params: {
  leagueId: string;
  season: number;
  scoring: ScoringFormat;
  week: number | null;
  limit?: number;
}): Promise<FreeAgentRow[]> {
  const supabase = await createClient();
  const { data: rostered } = await supabase
    .from("league_roster_entries")
    .select("fp_player_id, espn_player_id, player_name")
    .eq("league_id", params.leagueId);

  const rosteredFp = new Set<string>();
  const rosteredNames = new Set<string>();
  const espnIds: number[] = [];

  for (const r of rostered ?? []) {
    if (r.fp_player_id) rosteredFp.add(String(r.fp_player_id));
    if (r.player_name) rosteredNames.add(normalizePlayerName(String(r.player_name)));
    if (r.espn_player_id != null) espnIds.push(Number(r.espn_player_id));
  }

  if (espnIds.length > 0) {
    const { data: mapped } = await supabase
      .from("player_id_map")
      .select("fp_player_id")
      .in("espn_player_id", espnIds);
    for (const m of mapped ?? []) {
      if (m.fp_player_id) rosteredFp.add(String(m.fp_player_id));
    }
  }

  const projectionWeek =
    params.week != null && params.week > 0 ? params.week : null;
  const fetchLimit = Math.max((params.limit ?? 100) * 3, 200);

  type ProjRow = {
    fp_player_id: string;
    week: number;
    proj_points: number | null;
    players:
      | { name: string; position: string; nfl_team: string | null }
      | { name: string; position: string; nfl_team: string | null }[]
      | null;
  };

  const loadWeek = async (week: number) => {
    const { data } = await supabase
      .from("player_projections_weekly")
      .select("fp_player_id, week, proj_points, players(name, position, nfl_team)")
      .eq("season", params.season)
      .eq("scoring", params.scoring)
      .eq("week", week)
      .not("proj_points", "is", null)
      .order("proj_points", { ascending: false })
      .limit(fetchLimit);
    return (data ?? []) as ProjRow[];
  };

  const [weeklyRows, rosRows] = await Promise.all([
    projectionWeek != null ? loadWeek(projectionWeek) : Promise.resolve([] as ProjRow[]),
    loadWeek(0),
  ]);

  const byId = new Map<string, FreeAgentRow>();

  const ingest = (rows: ProjRow[], kind: "week" | "ros") => {
    for (const row of rows) {
      if (rosteredFp.has(row.fp_player_id)) continue;
      const player = Array.isArray(row.players) ? row.players[0] : row.players;
      if (!player) continue;
      if (rosteredNames.has(normalizePlayerName(player.name))) continue;

      const cur = byId.get(row.fp_player_id) ?? {
        fpPlayerId: row.fp_player_id,
        name: player.name,
        position: player.position,
        nflTeam: player.nfl_team,
        weekProj: null,
        rosProj: null,
        projectionWeek,
        source: "fantasypros" as const,
      };
      if (kind === "ros") cur.rosProj = row.proj_points;
      else cur.weekProj = row.proj_points;
      byId.set(row.fp_player_id, cur);
    }
  };

  ingest(rosRows, "ros");
  if (weeklyRows.length > 0) ingest(weeklyRows, "week");

  const list = [...byId.values()];
  list.sort((a, b) => {
    const aScore = a.weekProj ?? a.rosProj ?? 0;
    const bScore = b.weekProj ?? b.rosProj ?? 0;
    return bScore - aScore;
  });
  return list.slice(0, params.limit ?? 100);
}
