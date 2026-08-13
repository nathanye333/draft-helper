import type { DraftBundle } from "@/lib/draft/data";
import { computeDraftState, computeRosterForTeam } from "@/lib/draft/view";
import type { Position } from "@/lib/supabase/types";

export interface PlayerRow {
  fpPlayerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
  byeWeek: number | null;
  rankAdp: number | null;
  rankEcr: number | null;
  rankMin: number | null;
  rankMax: number | null;
  rankStd: number | null;
  tier: number | null;
  /** Scoring-aware projected fantasy points. */
  projPoints: number | null;
  /** ADP − ECR; positive = available later than experts prefer (value). */
  adpValue: number | null;
  /** Common volume stats flattened for sorting/filtering. */
  passYds: number | null;
  passTds: number | null;
  rushYds: number | null;
  rushTds: number | null;
  receptions: number | null;
  recYds: number | null;
  recTds: number | null;
  projStats: Record<string, number> | null;
  available: boolean;
  draftedBy: string | null;
  pickNumber: number | null;
}

export const PLAYER_SORT_COLUMNS = [
  "adp",
  "ecr",
  "tier",
  "name",
  "projPoints",
  "adpValue",
  "rankMin",
  "rankMax",
  "rankStd",
  "byeWeek",
  "passYds",
  "passTds",
  "rushYds",
  "rushTds",
  "receptions",
  "recYds",
  "recTds",
  "pickNumber",
] as const;

export type PlayerOrderBy = (typeof PLAYER_SORT_COLUMNS)[number];
export type OrderDir = "asc" | "desc";

export interface QueryPlayersParams {
  nameContains?: string;
  position?: Position;
  availableOnly?: boolean;
  adpMin?: number;
  adpMax?: number;
  ecrMin?: number;
  ecrMax?: number;
  tier?: number;
  nflTeam?: string;
  byeWeek?: number;
  projPointsMin?: number;
  projPointsMax?: number;
  adpValueMin?: number;
  limit?: number;
  orderBy?: PlayerOrderBy;
  orderDir?: OrderDir;
  /** Include full projStats blob in each row (larger payloads). */
  includeProjStats?: boolean;
}

export type AggregateGroupBy = "position" | "tier" | "nflTeam" | "byeWeek";
export type AggregateMetric = "adp" | "ecr" | "projPoints" | "adpValue";

export interface AggregatePlayersParams {
  groupBy: AggregateGroupBy;
  availableOnly?: boolean;
  metric?: AggregateMetric;
}

export interface AggregateBucket {
  key: string;
  count: number;
  metricMin: number | null;
  metricAvg: number | null;
  metricMax: number | null;
  /** @deprecated use metric* — kept for older prompts */
  adpMin: number | null;
  adpAvg: number | null;
  adpMax: number | null;
}

export const DATASET_COLUMNS = [
  { name: "name", type: "string", description: "Player display name" },
  { name: "position", type: "enum", description: "QB|RB|WR|TE|K|DST" },
  { name: "nflTeam", type: "string", description: "NFL team abbreviation" },
  { name: "byeWeek", type: "number", description: "Bye week" },
  { name: "rankAdp", type: "number", description: "Consensus ADP (lower = drafted earlier)" },
  { name: "rankEcr", type: "number", description: "Expert consensus rank (lower = better)" },
  { name: "rankMin", type: "number", description: "Best expert rank" },
  { name: "rankMax", type: "number", description: "Worst expert rank" },
  { name: "rankStd", type: "number", description: "Expert rank std-dev (uncertainty)" },
  { name: "tier", type: "number", description: "ECR tier bucket" },
  { name: "projPoints", type: "number", description: "Season projected fantasy points for draft scoring" },
  { name: "adpValue", type: "number", description: "ADP − ECR; positive means falling / value vs ADP" },
  { name: "passYds", type: "number", description: "Projected passing yards" },
  { name: "passTds", type: "number", description: "Projected passing TDs" },
  { name: "rushYds", type: "number", description: "Projected rushing yards" },
  { name: "rushTds", type: "number", description: "Projected rushing TDs" },
  { name: "receptions", type: "number", description: "Projected receptions" },
  { name: "recYds", type: "number", description: "Projected receiving yards" },
  { name: "recTds", type: "number", description: "Projected receiving TDs" },
  { name: "available", type: "boolean", description: "Still undrafted on this board" },
  { name: "draftedBy", type: "string", description: "Team that drafted the player" },
  { name: "pickNumber", type: "number", description: "Pick number if drafted" },
] as const;

function numStat(stats: Record<string, number> | null | undefined, key: string): number | null {
  if (!stats) return null;
  const raw = stats[key];
  if (raw == null) return null;
  const v = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** Flatten rankings + picks into analysis-friendly player rows for one draft. */
export function buildPlayerRows(bundle: DraftBundle): PlayerRow[] {
  const pickByPlayer = new Map(
    bundle.picks.map((p) => [
      p.fp_player_id,
      { teamName: p.draft_teams.name, pickNumber: p.pick_number },
    ]),
  );

  return bundle.rankings.map((r) => {
    const pick = pickByPlayer.get(r.fp_player_id);
    const stats = (r.proj_stats as Record<string, number> | null) ?? null;
    const rankAdp = r.rank_adp;
    const rankEcr = r.rank_ecr;
    return {
      fpPlayerId: r.fp_player_id,
      name: r.players.name,
      position: r.players.position,
      nflTeam: r.players.nfl_team,
      byeWeek: r.players.bye_week,
      rankAdp,
      rankEcr,
      rankMin: r.rank_min,
      rankMax: r.rank_max,
      rankStd: r.rank_std,
      tier: r.tier,
      projPoints: r.proj_points,
      adpValue: rankAdp != null && rankEcr != null ? rankAdp - rankEcr : null,
      passYds: numStat(stats, "pass_yds"),
      passTds: numStat(stats, "pass_tds"),
      rushYds: numStat(stats, "rush_yds"),
      rushTds: numStat(stats, "rush_tds"),
      receptions: numStat(stats, "rec_rec"),
      recYds: numStat(stats, "rec_yds"),
      recTds: numStat(stats, "rec_tds"),
      projStats: stats,
      available: !pick,
      draftedBy: pick?.teamName ?? null,
      pickNumber: pick?.pickNumber ?? null,
    };
  });
}

function compareNullable(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function sortValue(row: PlayerRow, orderBy: PlayerOrderBy): number | string | null {
  switch (orderBy) {
    case "name":
      return row.name;
    case "adp":
      return row.rankAdp;
    case "ecr":
      return row.rankEcr;
    case "tier":
      return row.tier;
    case "projPoints":
      return row.projPoints;
    case "adpValue":
      return row.adpValue;
    case "rankMin":
      return row.rankMin;
    case "rankMax":
      return row.rankMax;
    case "rankStd":
      return row.rankStd;
    case "byeWeek":
      return row.byeWeek;
    case "passYds":
      return row.passYds;
    case "passTds":
      return row.passTds;
    case "rushYds":
      return row.rushYds;
    case "rushTds":
      return row.rushTds;
    case "receptions":
      return row.receptions;
    case "recYds":
      return row.recYds;
    case "recTds":
      return row.recTds;
    case "pickNumber":
      return row.pickNumber;
    default:
      return row.rankAdp;
  }
}

/** Ranks/ADP: ascending = better by default. Points/volume/value: descending. */
export function defaultOrderDir(orderBy: PlayerOrderBy): OrderDir {
  if (
    orderBy === "projPoints" ||
    orderBy === "adpValue" ||
    orderBy === "passYds" ||
    orderBy === "passTds" ||
    orderBy === "rushYds" ||
    orderBy === "rushTds" ||
    orderBy === "receptions" ||
    orderBy === "recYds" ||
    orderBy === "recTds" ||
    orderBy === "rankStd"
  ) {
    return "desc";
  }
  return "asc";
}

function stripHeavyFields(row: PlayerRow, includeProjStats: boolean): PlayerRow {
  if (includeProjStats) return row;
  return { ...row, projStats: null };
}

export function queryPlayers(rows: PlayerRow[], params: QueryPlayersParams): PlayerRow[] {
  const {
    nameContains,
    position,
    availableOnly,
    adpMin,
    adpMax,
    ecrMin,
    ecrMax,
    tier,
    nflTeam,
    byeWeek,
    projPointsMin,
    projPointsMax,
    adpValueMin,
    limit = 25,
    orderBy = "adp",
    orderDir,
    includeProjStats = false,
  } = params;

  const dir = orderDir ?? defaultOrderDir(orderBy);
  const needle = nameContains?.trim().toLowerCase();
  const teamNeedle = nflTeam?.trim().toLowerCase();

  let filtered = rows.filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    if (position && row.position !== position) return false;
    if (availableOnly && !row.available) return false;
    if (adpMin != null && (row.rankAdp == null || row.rankAdp < adpMin)) return false;
    if (adpMax != null && (row.rankAdp == null || row.rankAdp > adpMax)) return false;
    if (ecrMin != null && (row.rankEcr == null || row.rankEcr < ecrMin)) return false;
    if (ecrMax != null && (row.rankEcr == null || row.rankEcr > ecrMax)) return false;
    if (tier != null && row.tier !== tier) return false;
    if (byeWeek != null && row.byeWeek !== byeWeek) return false;
    if (projPointsMin != null && (row.projPoints == null || row.projPoints < projPointsMin)) return false;
    if (projPointsMax != null && (row.projPoints == null || row.projPoints > projPointsMax)) return false;
    if (adpValueMin != null && (row.adpValue == null || row.adpValue < adpValueMin)) return false;
    if (teamNeedle && (row.nflTeam == null || !row.nflTeam.toLowerCase().includes(teamNeedle))) {
      return false;
    }
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    const av = sortValue(a, orderBy);
    const bv = sortValue(b, orderBy);
    let cmp: number;
    if (typeof av === "string" || typeof bv === "string") {
      cmp = String(av ?? "").localeCompare(String(bv ?? ""));
    } else {
      cmp = compareNullable(av, bv);
    }
    return dir === "desc" ? -cmp : cmp;
  });

  const capped = Math.min(Math.max(limit, 1), 100);
  return filtered.slice(0, capped).map((r) => stripHeavyFields(r, includeProjStats));
}

function metricValue(row: PlayerRow, metric: AggregateMetric): number | null {
  switch (metric) {
    case "ecr":
      return row.rankEcr;
    case "projPoints":
      return row.projPoints;
    case "adpValue":
      return row.adpValue;
    case "adp":
    default:
      return row.rankAdp;
  }
}

export function aggregatePlayers(
  rows: PlayerRow[],
  params: AggregatePlayersParams,
): AggregateBucket[] {
  const scoped = params.availableOnly ? rows.filter((r) => r.available) : rows;
  const metric = params.metric ?? "adp";
  const buckets = new Map<string, { count: number; values: number[] }>();

  for (const row of scoped) {
    let key: string;
    if (params.groupBy === "position") key = row.position;
    else if (params.groupBy === "tier") key = row.tier != null ? String(row.tier) : "unranked";
    else if (params.groupBy === "byeWeek") key = row.byeWeek != null ? String(row.byeWeek) : "unknown";
    else key = row.nflTeam ?? "FA";

    const bucket = buckets.get(key) ?? { count: 0, values: [] };
    bucket.count += 1;
    const v = metricValue(row, metric);
    if (v != null) bucket.values.push(v);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, { count, values }]) => {
      const metricMin = values.length ? Math.min(...values) : null;
      const metricMax = values.length ? Math.max(...values) : null;
      const metricAvg = values.length ? values.reduce((s, n) => s + n, 0) / values.length : null;
      const roundedAvg = metricAvg != null ? Math.round(metricAvg * 10) / 10 : null;
      return {
        key,
        count,
        metricMin,
        metricAvg: roundedAvg,
        metricMax,
        adpMin: metric === "adp" ? metricMin : null,
        adpAvg: metric === "adp" ? roundedAvg : null,
        adpMax: metric === "adp" ? metricMax : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function findPlayersByNameOrId(
  rows: PlayerRow[],
  query: string,
  limit = 10,
): PlayerRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const exactId = rows.filter((r) => r.fpPlayerId === query.trim());
  if (exactId.length) return exactId.slice(0, limit);

  const exactName = rows.filter((r) => r.name.toLowerCase() === needle);
  if (exactName.length) return exactName.slice(0, limit);

  return rows
    .filter((r) => r.name.toLowerCase().includes(needle))
    .sort((a, b) => compareNullable(a.rankAdp, b.rankAdp))
    .slice(0, limit);
}

/** Available players where ADP is later than ECR (falling / value). */
export function findValuePlays(
  rows: PlayerRow[],
  params: { position?: Position; minAdpValue?: number; limit?: number } = {},
): PlayerRow[] {
  return queryPlayers(rows, {
    availableOnly: true,
    position: params.position,
    adpValueMin: params.minAdpValue ?? 3,
    orderBy: "adpValue",
    orderDir: "desc",
    limit: params.limit ?? 15,
  });
}

export function analyzeTeamRoster(bundle: DraftBundle, teamId: string) {
  const team = bundle.teams.find((t) => t.id === teamId);
  if (!team) return { error: "Team not found" };

  const rows = buildPlayerRows(bundle).filter((r) => !r.available && r.draftedBy === team.name);
  const byPosition: Record<string, number> = {};
  let projPointsSum = 0;
  let projPointsKnown = 0;
  const byeWeeks = new Map<number, string[]>();

  for (const row of rows) {
    byPosition[row.position] = (byPosition[row.position] ?? 0) + 1;
    if (row.projPoints != null) {
      projPointsSum += row.projPoints;
      projPointsKnown += 1;
    }
    if (row.byeWeek != null) {
      const list = byeWeeks.get(row.byeWeek) ?? [];
      list.push(row.name);
      byeWeeks.set(row.byeWeek, list);
    }
  }

  const rosterSlots = computeRosterForTeam(bundle, teamId);

  return {
    team: { id: team.id, name: team.name, draftPosition: team.draft_position, isUserTeam: team.is_user_team },
    players: rows.map((r) => stripHeavyFields(r, false)),
    countsByPosition: byPosition,
    projectedPointsSum: projPointsKnown ? Math.round(projPointsSum * 10) / 10 : null,
    projectedPointsKnown: projPointsKnown,
    byeClusters: [...byeWeeks.entries()]
      .map(([week, names]) => ({ week, names }))
      .sort((a, b) => a.week - b.week),
    rosterSlots,
  };
}

export function getDraftSnapshot(bundle: DraftBundle) {
  const state = computeDraftState(bundle);
  const userRoster = state.userTeam ? computeRosterForTeam(bundle, state.userTeam.id) : null;
  const emptySlots =
    userRoster?.flatMap((slot) =>
      slot.playerNames
        .map((name, i) => ({ slotType: slot.slotType, index: i + 1, filled: name != null, playerName: name }))
        .filter((s) => !s.filled)
        .map((s) => `${s.slotType}${slot.playerNames.length > 1 ? ` #${s.index}` : ""}`),
    ) ?? [];

  const rows = buildPlayerRows(bundle);
  const withProj = rows.filter((r) => r.projPoints != null).length;

  return {
    draftName: bundle.draft.name,
    season: bundle.draft.season,
    scoring: bundle.draft.scoring,
    status: bundle.draft.status,
    numTeams: bundle.draft.num_teams,
    currentPickNumber: state.currentPickNumber,
    currentRound: state.currentRound,
    onClockTeam: state.onClockTeam
      ? { name: state.onClockTeam.name, draftPosition: state.onClockTeam.draft_position }
      : null,
    userTeam: state.userTeam
      ? { name: state.userTeam.name, draftPosition: state.userTeam.draft_position }
      : null,
    picksMade: bundle.picks.length,
    availablePlayers: state.availableRankings.length,
    playersWithProjections: withProj,
    emptyStarterOrBenchSlots: emptySlots,
    sortableColumns: PLAYER_SORT_COLUMNS,
  };
}
