import type { EspnCookies } from "@/lib/espn/client";
import { EspnApiError } from "@/lib/espn/client";

const ESPN_READ_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

const POSITION_ID: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

const NFL_TEAM_ABBREV: Record<number, string> = {
  0: "FA",
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

export function espnHeadshotUrl(espnPlayerId: number, position: string): string {
  if (position === "DST") {
    return `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/default-team-logo-500.png`;
  }
  return `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnPlayerId}.png&w=350&h=254`;
}

function normalizeCookies(cookies: EspnCookies): { SWID: string; espn_s2: string } {
  let swid = cookies.swid.trim();
  if (!swid.startsWith("{")) swid = `{${swid.replace(/^\{|\}$/g, "")}}`;
  return { SWID: swid, espn_s2: cookies.espnS2.trim() };
}

async function espnFetchFiltered(
  path: string,
  cookies: EspnCookies,
  params: Record<string, string>,
  fantasyFilter: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${ESPN_READ_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const cookieHeader = normalizeCookies(cookies);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Cookie: `SWID=${cookieHeader.SWID}; espn_s2=${cookieHeader.espn_s2}`,
      "X-Fantasy-Filter": JSON.stringify(fantasyFilter),
    },
  });
  if (!response.ok) {
    throw new EspnApiError(
      `ESPN player pool failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }
  return response.json();
}

export type EspnOwnership = "ONTEAM" | "WAIVERS" | "FREEAGENT";

export interface EspnWeekPoints {
  week: number;
  actual: number | null;
  projected: number | null;
}

export interface EspnPlayerUniverseRow {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  headshotUrl: string;
  ownership: EspnOwnership;
  espnTeamId: number | null;
  percentOwned: number | null;
  injuryStatus: string | null;
  /** Points keyed by season → week → actual/projected (week 0 = season total). */
  pointsBySeason: Map<number, Map<number, EspnWeekPoints>>;
}

function mapOwnership(raw: string | undefined, onTeamId: number | null): EspnOwnership {
  if (onTeamId != null && onTeamId > 0) return "ONTEAM";
  const u = (raw ?? "").toUpperCase();
  if (u === "WAIVERS" || u === "WAIVER") return "WAIVERS";
  if (u === "ONTEAM") return "ONTEAM";
  return "FREEAGENT";
}

function parsePlayerStats(
  stats: unknown[] | undefined,
  seasons: number[],
): Map<number, Map<number, EspnWeekPoints>> {
  const bySeason = new Map<number, Map<number, EspnWeekPoints>>();
  for (const season of seasons) bySeason.set(season, new Map());

  for (const s of stats ?? []) {
    const row = s as Record<string, unknown>;
    const scoringPeriodId = Number(row.scoringPeriodId ?? -1);
    const statSourceId = Number(row.statSourceId ?? -1);
    const seasonId = Number(row.seasonId ?? 0);
    if (!seasons.includes(seasonId)) continue;
    if (scoringPeriodId < 0) continue;
    // 0 = actual, 1 = projected
    if (statSourceId !== 0 && statSourceId !== 1) continue;
    const applied =
      row.appliedTotal != null && Number.isFinite(Number(row.appliedTotal))
        ? Number(row.appliedTotal)
        : null;

    const weekMap = bySeason.get(seasonId)!;
    const cur = weekMap.get(scoringPeriodId) ?? {
      week: scoringPeriodId,
      actual: null,
      projected: null,
    };
    if (statSourceId === 0) cur.actual = applied;
    else cur.projected = applied;
    weekMap.set(scoringPeriodId, cur);
  }
  return bySeason;
}

/**
 * Pull ESPN player universe for a league: ownership, headshots, week/season
 * actual + projected fantasy points for current and prior season (league scoring).
 */
export async function fetchEspnPlayerUniverse(params: {
  leagueId: string;
  season: number;
  cookies: EspnCookies;
  currentWeek: number | null;
}): Promise<EspnPlayerUniverseRow[]> {
  const prior = params.season - 1;
  const seasons = [params.season, prior];
  // Stat split ids: 00YEAR = season actual, 10YEAR = season projected.
  const additionalValue = [
    `00${params.season}`,
    `10${params.season}`,
    `00${prior}`,
    `10${prior}`,
  ];
  const topPeriods = 18;

  const path = `/seasons/${params.season}/segments/0/leagues/${params.leagueId}`;
  const json = (await espnFetchFiltered(
    path,
    params.cookies,
    { view: "kona_player_info" },
    {
      players: {
        limit: 2500,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
        filterStatsForTopScoringPeriodIds: {
          value: topPeriods,
          additionalValue,
        },
      },
    },
  )) as { players?: unknown[] };

  const out: EspnPlayerUniverseRow[] = [];
  for (const entry of json.players ?? []) {
    const wrap = entry as Record<string, unknown>;
    const player = wrap.player as Record<string, unknown> | undefined;
    if (!player) continue;
    const espnPlayerId = Number(player.id);
    if (!Number.isFinite(espnPlayerId)) continue;
    const position = String(POSITION_ID[Number(player.defaultPositionId)] ?? "UNK");
    const onTeamId =
      wrap.onTeamId != null && Number(wrap.onTeamId) > 0 ? Number(wrap.onTeamId) : null;
    const ownership = mapOwnership(
      typeof wrap.status === "string" ? wrap.status : undefined,
      onTeamId,
    );
    const name = String(player.fullName ?? `Player ${espnPlayerId}`);
    const nflTeam = NFL_TEAM_ABBREV[Number(player.proTeamId)] ?? null;
    const pointsBySeason = parsePlayerStats(player.stats as unknown[] | undefined, seasons);

    out.push({
      espnPlayerId,
      name,
      position,
      nflTeam,
      headshotUrl: espnHeadshotUrl(espnPlayerId, position),
      ownership,
      espnTeamId: onTeamId,
      percentOwned: wrap.percentOwned != null ? Number(wrap.percentOwned) : null,
      injuryStatus: player.injuryStatus != null ? String(player.injuryStatus) : null,
      pointsBySeason,
    });
  }
  return out;
}

export function summaryFromUniverse(
  row: EspnPlayerUniverseRow,
  season: number,
  currentWeek: number | null,
): {
  weekProjected: number | null;
  weekActual: number | null;
  seasonProjected: number | null;
  seasonActual: number | null;
} {
  const weeks = row.pointsBySeason.get(season);
  const seasonTotal = weeks?.get(0);
  const weekRow =
    currentWeek != null && currentWeek > 0 ? weeks?.get(currentWeek) : undefined;
  return {
    weekProjected: weekRow?.projected ?? null,
    weekActual: weekRow?.actual ?? null,
    seasonProjected: seasonTotal?.projected ?? null,
    seasonActual: seasonTotal?.actual ?? null,
  };
}
