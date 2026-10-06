import { createClient } from "@/lib/supabase/server";
import {
  detectPlayerDataFlags,
  preferredWeekProj,
  summarizeSeasonForm,
  type PlayerEvalFlag,
  type PlayerWeekSample,
} from "@/lib/analytics/player-eval";
import type { ScoringFormat } from "@/lib/supabase/types";

export interface PlayerEvaluation {
  espnPlayerId: number;
  fpPlayerId: string | null;
  name: string;
  position: string;
  nflTeam: string | null;
  ownership: string | null;
  fantasyTeam: string | null;
  season: number;
  currentWeek: number | null;
  scoring: ScoringFormat;
  fpWeekProj: number | null;
  fpRosProj: number | null;
  espnWeekProj: number | null;
  espnSeasonActual: number | null;
  espnSeasonProjected: number | null;
  seasonGames: number;
  seasonAvg: number | null;
  recentWeeks: PlayerWeekSample[];
  recentAvg: number | null;
  preferredWeekProj: number | null;
  preferredWeekProjSource: "fantasypros" | "espn" | null;
  dataFlags: PlayerEvalFlag[];
  dataNotes: string[];
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type PoolJoinRow = {
  espn_player_id: number;
  ownership: string | null;
  espn_team_id: number | null;
  injury_status: string | null;
  week_projected: number | null;
  week_actual: number | null;
  season_projected: number | null;
  season_actual: number | null;
  fp_player_id: string | null;
  percent_owned: number | null;
  espn_players:
    | { name: string; position: string; nfl_team: string | null }
    | { name: string; position: string; nfl_team: string | null }[]
    | null;
};

function playerFromPool(row: PoolJoinRow): {
  name: string;
  position: string;
  nflTeam: string | null;
} {
  const ep = Array.isArray(row.espn_players) ? row.espn_players[0] : row.espn_players;
  return {
    name: ep?.name ?? `Player ${row.espn_player_id}`,
    position: ep?.position ?? "UNK",
    nflTeam: ep?.nfl_team ?? null,
  };
}

const POOL_SELECT =
  "espn_player_id, ownership, espn_team_id, injury_status, week_projected, week_actual, season_projected, season_actual, fp_player_id, percent_owned, espn_players(name, position, nfl_team)";

/**
 * Resolve pool players by ESPN id and/or name substring (FA or rostered).
 */
async function resolvePoolCandidates(params: {
  leagueId: string;
  espnPlayerIds?: number[];
  names?: string[];
  limit?: number;
}): Promise<PoolJoinRow[]> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(params.limit ?? 12, 1), 20);
  const byId = new Map<number, PoolJoinRow>();

  const ids = [...new Set(params.espnPlayerIds ?? [])].filter((id) => Number.isFinite(id));

  // Name → espn_players → pool (avoids scanning the full league pool).
  for (const name of params.names ?? []) {
    const needle = name.trim();
    if (!needle) continue;
    const { data: nameHits } = await supabase
      .from("espn_players")
      .select("espn_player_id, name")
      .ilike("name", `%${needle}%`)
      .limit(15);
    const ranked = [...(nameHits ?? [])].sort((a, b) => {
      const aExact = normalizeName(String(a.name)) === normalizeName(needle) ? 0 : 1;
      const bExact = normalizeName(String(b.name)) === normalizeName(needle) ? 0 : 1;
      return aExact - bExact || String(a.name).localeCompare(String(b.name));
    });
    for (const hit of ranked.slice(0, 5)) {
      ids.push(Number(hit.espn_player_id));
    }
  }

  const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(id));
  if (uniqueIds.length === 0) return [];

  const { data } = await supabase
    .from("league_player_pool")
    .select(POOL_SELECT)
    .eq("league_id", params.leagueId)
    .in("espn_player_id", uniqueIds);

  for (const row of (data ?? []) as PoolJoinRow[]) {
    byId.set(row.espn_player_id, row);
  }

  // Preserve name-match preference order when possible.
  const ordered: PoolJoinRow[] = [];
  for (const id of uniqueIds) {
    const row = byId.get(id);
    if (row) ordered.push(row);
  }
  return ordered.slice(0, limit);
}

/**
 * Evaluate named / ESPN-id players with current-week projections + season form.
 * Prefer this over board `get_player` (season-long rankings) for in-season decisions.
 */
export async function evaluateLeaguePlayers(params: {
  leagueId: string;
  espnPlayerIds?: number[];
  names?: string[];
  recentWindow?: number;
  limit?: number;
}): Promise<{
  season: number;
  currentWeek: number | null;
  scoring: ScoringFormat;
  players: PlayerEvaluation[];
  error?: string;
}> {
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("season, scoring, current_week")
    .eq("id", params.leagueId)
    .single();

  if (!league) {
    return {
      season: 0,
      currentWeek: null,
      scoring: "PPR",
      players: [],
      error: "League not found",
    };
  }

  const season = Number(league.season);
  const scoring = league.scoring as ScoringFormat;
  const currentWeek =
    league.current_week != null && Number(league.current_week) > 0
      ? Number(league.current_week)
      : null;

  if (
    (!params.espnPlayerIds || params.espnPlayerIds.length === 0) &&
    (!params.names || params.names.length === 0)
  ) {
    return {
      season,
      currentWeek,
      scoring,
      players: [],
      error: "Provide espnPlayerIds and/or names",
    };
  }

  const poolRows = await resolvePoolCandidates({
    leagueId: params.leagueId,
    espnPlayerIds: params.espnPlayerIds,
    names: params.names,
    limit: params.limit,
  });

  if (poolRows.length === 0) {
    return {
      season,
      currentWeek,
      scoring,
      players: [],
      error:
        "No matching players in the ESPN player pool. Sync ESPN (full) so free agents and week points populate.",
    };
  }

  const espnIds = poolRows.map((r) => r.espn_player_id);
  const teamIds = [
    ...new Set(
      poolRows
        .map((r) => r.espn_team_id)
        .filter((id): id is number => id != null && Number.isFinite(id)),
    ),
  ];

  const [{ data: weekPts }, { data: teams }, fpProjs] = await Promise.all([
    supabase
      .from("espn_player_week_points")
      .select("espn_player_id, week, actual_points, projected_points")
      .eq("league_id", params.leagueId)
      .eq("season", season)
      .in("espn_player_id", espnIds)
      .gte("week", 1)
      .order("week", { ascending: true }),
    teamIds.length > 0
      ? supabase
          .from("league_teams")
          .select("espn_team_id, name")
          .eq("league_id", params.leagueId)
          .in("espn_team_id", teamIds)
      : Promise.resolve({ data: [] as { espn_team_id: number; name: string }[] }),
    (async () => {
      const fpIds = [
        ...new Set(poolRows.map((r) => r.fp_player_id).filter((id): id is string => !!id)),
      ];
      if (fpIds.length === 0) return new Map<string, { week: number | null; ros: number | null }>();
      const weekFilter = currentWeek != null ? [0, currentWeek] : [0];
      const { data } = await supabase
        .from("player_projections_weekly")
        .select("fp_player_id, week, proj_points")
        .eq("season", season)
        .eq("scoring", scoring)
        .in("week", weekFilter)
        .in("fp_player_id", fpIds);
      const map = new Map<string, { week: number | null; ros: number | null }>();
      for (const p of data ?? []) {
        const cur = map.get(String(p.fp_player_id)) ?? { week: null, ros: null };
        if (p.week === 0) cur.ros = p.proj_points as number | null;
        else if (currentWeek != null && p.week === currentWeek) {
          cur.week = p.proj_points as number | null;
        }
        map.set(String(p.fp_player_id), cur);
      }
      return map;
    })(),
  ]);

  const teamName = new Map(
    (teams ?? []).map((t) => [Number(t.espn_team_id), String(t.name)]),
  );

  const weeksById = new Map<number, PlayerWeekSample[]>();
  for (const row of weekPts ?? []) {
    const id = Number(row.espn_player_id);
    const list = weeksById.get(id) ?? [];
    list.push({
      week: Number(row.week),
      actual: row.actual_points != null ? Number(row.actual_points) : null,
      projected: row.projected_points != null ? Number(row.projected_points) : null,
    });
    weeksById.set(id, list);
  }

  const recentWindow = params.recentWindow ?? 3;
  const players: PlayerEvaluation[] = poolRows.map((row) => {
    const meta = playerFromPool(row);
    const fpId = row.fp_player_id ? String(row.fp_player_id) : null;
    const fp = fpId ? fpProjs.get(fpId) : undefined;
    const seasonWeeksActuals = weeksById.get(row.espn_player_id) ?? [];
    const form = summarizeSeasonForm({
      currentWeek,
      seasonWeeksActuals,
      recentWindow,
    });
    const fpWeekProj = fp?.week ?? null;
    const fpRosProj = fp?.ros ?? null;
    const espnWeekProj =
      row.week_projected != null ? Number(row.week_projected) : null;
    const { flags, notes } = detectPlayerDataFlags({
      currentWeek,
      fpWeekProj,
      fpRosProj,
      espnWeekProj,
      seasonWeeksActuals,
      recentWindow,
    });
    const preferred = preferredWeekProj({ fpWeekProj, espnWeekProj });

    return {
      espnPlayerId: row.espn_player_id,
      fpPlayerId: fpId,
      name: meta.name,
      position: meta.position,
      nflTeam: meta.nflTeam,
      ownership: row.ownership,
      fantasyTeam:
        row.espn_team_id != null ? (teamName.get(Number(row.espn_team_id)) ?? null) : null,
      season,
      currentWeek,
      scoring,
      fpWeekProj,
      fpRosProj,
      espnWeekProj,
      espnSeasonActual:
        row.season_actual != null ? Number(row.season_actual) : null,
      espnSeasonProjected:
        row.season_projected != null ? Number(row.season_projected) : null,
      seasonGames: form.seasonGames,
      seasonAvg: form.seasonAvg,
      recentWeeks: form.recentWeeks,
      recentAvg: form.recentAvg,
      preferredWeekProj: preferred.value,
      preferredWeekProjSource: preferred.source,
      dataFlags: flags,
      dataNotes: notes,
    };
  });

  return { season, currentWeek, scoring, players };
}

/**
 * Batch recent-form + ESPN week proj for free-agent rows (by FP id).
 */
export async function fetchFreeAgentFormByFpIds(params: {
  leagueId: string;
  season: number;
  currentWeek: number | null;
  fpPlayerIds: string[];
  recentWindow?: number;
}): Promise<
  Map<
    string,
    {
      espnPlayerId: number;
      espnWeekProj: number | null;
      espnSeasonActual: number | null;
      recentAvg: number | null;
      seasonAvg: number | null;
      seasonGames: number;
      recentWeeks: PlayerWeekSample[];
      seasonWeeksActuals: PlayerWeekSample[];
      percentOwned: number | null;
    }
  >
> {
  const out = new Map<
    string,
    {
      espnPlayerId: number;
      espnWeekProj: number | null;
      espnSeasonActual: number | null;
      recentAvg: number | null;
      seasonAvg: number | null;
      seasonGames: number;
      recentWeeks: PlayerWeekSample[];
      seasonWeeksActuals: PlayerWeekSample[];
      percentOwned: number | null;
    }
  >();
  const fpIds = [...new Set(params.fpPlayerIds)].filter(Boolean);
  if (fpIds.length === 0) return out;

  const supabase = await createClient();
  const { data: pool } = await supabase
    .from("league_player_pool")
    .select(
      "espn_player_id, fp_player_id, week_projected, season_actual, percent_owned",
    )
    .eq("league_id", params.leagueId)
    .in("fp_player_id", fpIds);

  if (!pool?.length) return out;

  const espnIds = pool.map((p) => Number(p.espn_player_id));
  const { data: weekPts } = await supabase
    .from("espn_player_week_points")
    .select("espn_player_id, week, actual_points, projected_points")
    .eq("league_id", params.leagueId)
    .eq("season", params.season)
    .in("espn_player_id", espnIds)
    .gte("week", 1)
    .order("week", { ascending: true });

  const weeksById = new Map<number, PlayerWeekSample[]>();
  for (const row of weekPts ?? []) {
    const id = Number(row.espn_player_id);
    const list = weeksById.get(id) ?? [];
    list.push({
      week: Number(row.week),
      actual: row.actual_points != null ? Number(row.actual_points) : null,
      projected: row.projected_points != null ? Number(row.projected_points) : null,
    });
    weeksById.set(id, list);
  }

  const recentWindow = params.recentWindow ?? 3;
  for (const p of pool) {
    const fpId = p.fp_player_id ? String(p.fp_player_id) : null;
    if (!fpId) continue;
    const espnId = Number(p.espn_player_id);
    const seasonWeeksActuals = weeksById.get(espnId) ?? [];
    const form = summarizeSeasonForm({
      currentWeek: params.currentWeek,
      seasonWeeksActuals,
      recentWindow,
    });
    out.set(fpId, {
      espnPlayerId: espnId,
      espnWeekProj: p.week_projected != null ? Number(p.week_projected) : null,
      espnSeasonActual: p.season_actual != null ? Number(p.season_actual) : null,
      recentAvg: form.recentAvg,
      seasonAvg: form.seasonAvg,
      seasonGames: form.seasonGames,
      recentWeeks: form.recentWeeks,
      seasonWeeksActuals,
      percentOwned: p.percent_owned != null ? Number(p.percent_owned) : null,
    });
  }

  return out;
}
