import type { Position, ScoringFormat, SlotType } from "@/lib/supabase/types";

const ESPN_READ_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

export class EspnApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EspnApiError";
  }
}

export interface EspnCookies {
  swid: string;
  espnS2: string;
}

/** ESPN lineup slot id → our slot label */
const LINEUP_SLOT: Record<number, string> = {
  0: "QB",
  1: "TQB",
  2: "RB",
  3: "RB/WR",
  4: "WR",
  5: "WR/TE",
  6: "TE",
  7: "OP",
  8: "DT",
  9: "DE",
  10: "LB",
  11: "DL",
  12: "CB",
  13: "S",
  14: "DB",
  15: "DP",
  16: "DST",
  17: "K",
  20: "BENCH",
  21: "IR",
  22: "UNKNOWN",
  23: "FLEX",
  24: "SUPERFLEX",
};

const POSITION_ID: Record<number, Position | string> = {
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

export interface EspnTeamParsed {
  espnTeamId: number;
  name: string;
  abbrev: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number | null;
  pointsAgainst: number | null;
  playoffSeed: number | null;
}

export interface EspnRosterEntryParsed {
  espnTeamId: number;
  espnPlayerId: number;
  playerName: string;
  position: string;
  nflTeam: string | null;
  lineupSlot: string;
  injuryStatus: string | null;
}

export interface EspnMatchupParsed {
  week: number;
  homeEspnTeamId: number;
  awayEspnTeamId: number;
  homePoints: number | null;
  awayPoints: number | null;
}

export interface EspnLeagueSnapshot {
  name: string;
  season: number;
  currentWeek: number | null;
  scoring: ScoringFormat;
  rosterSlots: { slot_type: SlotType; count: number }[];
  teams: EspnTeamParsed[];
  rosterEntries: EspnRosterEntryParsed[];
  matchups: EspnMatchupParsed[];
}

function normalizeCookies(cookies: EspnCookies): { SWID: string; espn_s2: string } {
  let swid = cookies.swid.trim();
  if (!swid.startsWith("{")) swid = `{${swid.replace(/^\{|\}$/g, "")}}`;
  return { SWID: swid, espn_s2: cookies.espnS2.trim() };
}

async function espnFetch(
  path: string,
  cookies: EspnCookies,
  params: Record<string, string | string[]> = {},
): Promise<unknown> {
  const url = new URL(`${ESPN_READ_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, v);
    } else {
      url.searchParams.set(key, value);
    }
  }

  const cookieHeader = normalizeCookies(cookies);
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Cookie: `SWID=${cookieHeader.SWID}; espn_s2=${cookieHeader.espn_s2}`,
    },
  });

  if (!response.ok) {
    throw new EspnApiError(
      `ESPN request failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return response.json();
}

function mapScoring(settings: Record<string, unknown> | undefined): ScoringFormat {
  const scoringSettings = settings?.scoringSettings as Record<string, unknown> | undefined;
  const scoringItems = (scoringSettings?.scoringItems as { statId?: number; points?: number }[]) ?? [];
  const reception = scoringItems.find((s) => s.statId === 53);
  const pts = reception?.points ?? 0;
  if (pts >= 0.9) return "PPR";
  if (pts >= 0.4) return "HALF";
  return "STD";
}

function mapRosterSlots(
  rosterSettings: Record<string, unknown> | undefined,
): { slot_type: SlotType; count: number }[] {
  const positions = (rosterSettings?.lineupSlotCounts as Record<string, number>) ?? {};
  const out: { slot_type: SlotType; count: number }[] = [];
  const add = (slot: SlotType, espnId: number) => {
    const count = positions[String(espnId)] ?? 0;
    if (count > 0) out.push({ slot_type: slot, count });
  };
  add("QB", 0);
  add("RB", 2);
  add("WR", 4);
  add("TE", 6);
  add("FLEX", 23);
  add("DST", 16);
  add("K", 17);
  add("BENCH", 20);
  add("IR", 21);
  if (out.length === 0) {
    return [
      { slot_type: "QB", count: 1 },
      { slot_type: "RB", count: 2 },
      { slot_type: "WR", count: 2 },
      { slot_type: "TE", count: 1 },
      { slot_type: "FLEX", count: 1 },
      { slot_type: "DST", count: 1 },
      { slot_type: "K", count: 1 },
      { slot_type: "BENCH", count: 6 },
      { slot_type: "IR", count: 2 },
    ];
  }
  return out;
}

function parseTeams(raw: unknown[]): EspnTeamParsed[] {
  return raw.map((t) => {
    const team = t as Record<string, unknown>;
    const record = (team.record as { overall?: Record<string, number> } | undefined)?.overall;
    return {
      espnTeamId: Number(team.id),
      name: String(team.name ?? `Team ${team.id}`),
      abbrev: team.abbrev != null ? String(team.abbrev) : null,
      wins: record?.wins ?? 0,
      losses: record?.losses ?? 0,
      ties: record?.ties ?? 0,
      pointsFor: record?.pointsFor ?? null,
      pointsAgainst: record?.pointsAgainst ?? null,
      playoffSeed: team.playoffSeed != null ? Number(team.playoffSeed) : null,
    };
  });
}

function parseRosters(teams: unknown[]): EspnRosterEntryParsed[] {
  const entries: EspnRosterEntryParsed[] = [];
  for (const t of teams) {
    const team = t as Record<string, unknown>;
    const espnTeamId = Number(team.id);
    const roster = team.roster as { entries?: unknown[] } | undefined;
    for (const e of roster?.entries ?? []) {
      const entry = e as Record<string, unknown>;
      const playerPool = entry.playerPoolEntry as Record<string, unknown> | undefined;
      const player = playerPool?.player as Record<string, unknown> | undefined;
      if (!player) continue;
      const espnPlayerId = Number(player.id ?? entry.playerId);
      const lineupSlotId = Number(entry.lineupSlotId ?? 20);
      entries.push({
        espnTeamId,
        espnPlayerId,
        playerName: String(player.fullName ?? `Player ${espnPlayerId}`),
        position: String(POSITION_ID[Number(player.defaultPositionId)] ?? "UNK"),
        nflTeam: NFL_TEAM_ABBREV[Number(player.proTeamId)] ?? null,
        lineupSlot: LINEUP_SLOT[lineupSlotId] ?? "BENCH",
        injuryStatus:
          player.injuryStatus != null
            ? String(player.injuryStatus)
            : ((playerPool?.status as string | undefined) ?? null),
      });
    }
  }
  return entries;
}

function parseMatchups(schedule: unknown[], week: number | null): EspnMatchupParsed[] {
  if (week == null) return [];
  const out: EspnMatchupParsed[] = [];
  for (const m of schedule) {
    const matchup = m as Record<string, unknown>;
    if (Number(matchup.matchupPeriodId) !== week) continue;
    const home = matchup.home as Record<string, unknown> | undefined;
    const away = matchup.away as Record<string, unknown> | undefined;
    if (!home?.teamId || !away?.teamId) continue;
    out.push({
      week,
      homeEspnTeamId: Number(home.teamId),
      awayEspnTeamId: Number(away.teamId),
      homePoints: home.totalPoints != null ? Number(home.totalPoints) : null,
      awayPoints: away.totalPoints != null ? Number(away.totalPoints) : null,
    });
  }
  return out;
}

/**
 * Fetch league settings, teams, rosters, standings, and current-week matchups.
 * Server-only. Requires SWID + espn_s2 for private leagues.
 */
export async function fetchEspnLeagueSnapshot(params: {
  leagueId: string;
  season: number;
  cookies: EspnCookies;
}): Promise<EspnLeagueSnapshot> {
  const path = `/seasons/${params.season}/segments/0/leagues/${params.leagueId}`;
  const json = (await espnFetch(path, params.cookies, {
    view: ["mSettings", "mTeam", "mRoster", "mMatchup", "mStandings"],
  })) as Record<string, unknown>;

  const settings = json.settings as Record<string, unknown> | undefined;
  const status = json.status as Record<string, unknown> | undefined;
  const teamsRaw = (json.teams as unknown[]) ?? [];
  const schedule = (json.schedule as unknown[]) ?? [];

  const currentWeek =
    status?.currentMatchupPeriod != null
      ? Number(status.currentMatchupPeriod)
      : status?.latestScoringPeriod != null
        ? Number(status.latestScoringPeriod)
        : null;

  const name =
    (settings?.name as string | undefined) ||
    `ESPN League ${params.leagueId}`;

  return {
    name,
    season: params.season,
    currentWeek,
    scoring: mapScoring(settings),
    rosterSlots: mapRosterSlots(settings?.rosterSettings as Record<string, unknown> | undefined),
    teams: parseTeams(teamsRaw),
    rosterEntries: parseRosters(teamsRaw),
    matchups: parseMatchups(schedule, currentWeek),
  };
}

/** Lightweight fetch used when connecting — validate cookies and list teams. */
export async function fetchEspnTeamsPreview(params: {
  leagueId: string;
  season: number;
  cookies: EspnCookies;
}): Promise<{ name: string; teams: EspnTeamParsed[]; scoring: ScoringFormat }> {
  const snap = await fetchEspnLeagueSnapshot(params);
  return { name: snap.name, teams: snap.teams, scoring: snap.scoring };
}
