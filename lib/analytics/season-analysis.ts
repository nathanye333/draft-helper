import {
  computeConsistency,
  type ConsistencyStats,
} from "@/lib/analytics/consistency";

export interface SeasonAnalysisRow {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  fantasyTeam: string | null;
  available: boolean;
  games: number;
  mean: number | null;
  stdev: number | null;
  cv: number | null;
  /** mean / stdev — higher = productive relative to volatility. null if stdev missing/0. */
  consistencyScore: number | null;
  floor: number | null;
  ceiling: number | null;
  boomRate: number | null;
  bustRate: number | null;
  consistencyLabel: ConsistencyStats["label"];
  weekProj: number | null;
  rosProj: number | null;
}

export const SEASON_ANALYSIS_COLUMNS = [
  "name",
  "position",
  "nflTeam",
  "fantasyTeam",
  "available",
  "games",
  "mean",
  "stdev",
  "cv",
  "consistencyScore",
  "floor",
  "ceiling",
  "boomRate",
  "bustRate",
  "consistencyLabel",
  "weekProj",
  "rosProj",
] as const;

export type SeasonAnalysisOrderBy = (typeof SEASON_ANALYSIS_COLUMNS)[number];

export function buildSeasonAnalysisRow(params: {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  fantasyTeam: string | null;
  available: boolean;
  weekActuals: number[];
  weekProj: number | null;
  rosProj: number | null;
}): SeasonAnalysisRow {
  const c = computeConsistency(params.weekActuals);
  const consistencyScore =
    c.mean != null && c.stdev != null && c.stdev > 0
      ? Math.round((c.mean / c.stdev) * 100) / 100
      : null;
  return {
    espnPlayerId: params.espnPlayerId,
    name: params.name,
    position: params.position,
    nflTeam: params.nflTeam,
    fantasyTeam: params.fantasyTeam,
    available: params.available,
    games: c.games,
    mean: c.mean,
    stdev: c.stdev,
    cv: c.cv,
    consistencyScore,
    floor: c.floor,
    ceiling: c.ceiling,
    boomRate: c.boomRate,
    bustRate: c.bustRate,
    consistencyLabel: c.label,
    weekProj: params.weekProj,
    rosProj: params.rosProj,
  };
}

export interface AnalyzeSeasonPlayersParams {
  position?: string;
  availableOnly?: boolean;
  nameContains?: string;
  minGames?: number;
  minMean?: number;
  maxCv?: number;
  orderBy?: SeasonAnalysisOrderBy;
  orderDir?: "asc" | "desc";
  limit?: number;
}

function sortValue(row: SeasonAnalysisRow, orderBy: SeasonAnalysisOrderBy): number | string | null {
  const v = row[orderBy];
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as number | string | null;
}

/**
 * Filter + sort season analysis rows. Default order: consistencyScore desc
 * (productive + steady = high mean/σ).
 */
export function analyzeSeasonPlayers(
  rows: SeasonAnalysisRow[],
  params: AnalyzeSeasonPlayersParams = {},
): SeasonAnalysisRow[] {
  let out = rows;
  if (params.position) {
    const pos = params.position.toUpperCase();
    out = out.filter((r) => r.position === pos);
  }
  if (params.availableOnly) out = out.filter((r) => r.available);
  if (params.nameContains) {
    const needle = params.nameContains.toLowerCase();
    out = out.filter((r) => r.name.toLowerCase().includes(needle));
  }
  if (params.minGames != null) out = out.filter((r) => r.games >= params.minGames!);
  if (params.minMean != null) {
    out = out.filter((r) => r.mean != null && r.mean >= params.minMean!);
  }
  if (params.maxCv != null) {
    out = out.filter((r) => r.cv != null && r.cv <= params.maxCv!);
  }

  const orderBy = params.orderBy ?? "consistencyScore";
  const dir = params.orderDir ?? (orderBy === "cv" || orderBy === "stdev" || orderBy === "bustRate" ? "asc" : "desc");
  const mult = dir === "asc" ? 1 : -1;

  out = [...out].sort((a, b) => {
    const av = sortValue(a, orderBy);
    const bv = sortValue(b, orderBy);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return mult * av.localeCompare(bv);
    }
    return mult * (Number(av) - Number(bv));
  });

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 80);
  return out.slice(0, limit);
}
