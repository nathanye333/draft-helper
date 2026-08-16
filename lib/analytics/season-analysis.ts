import {
  computeConsistency,
  type ConsistencyStats,
} from "@/lib/analytics/consistency";
import { evalSafeExpr, roundExpr } from "@/lib/analytics/safe-expr";

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
  /** Agent-defined derived metrics from safe expressions. */
  computed?: Record<string, number | null>;
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

/** Numeric fields usable in compute expressions. */
export const SEASON_ANALYSIS_EXPR_VARS = [
  "games",
  "mean",
  "stdev",
  "cv",
  "consistencyScore",
  "floor",
  "ceiling",
  "boomRate",
  "bustRate",
  "weekProj",
  "rosProj",
] as const;

export type SeasonAnalysisOrderBy = (typeof SEASON_ANALYSIS_COLUMNS)[number] | string;

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

export interface ComputedMetricDef {
  /** Output field name, e.g. "riskAdjusted" */
  as: string;
  /** Safe expr over SEASON_ANALYSIS_EXPR_VARS, e.g. "mean / max(stdev, 0.1)" */
  expr: string;
}

export interface AnalyzeSeasonPlayersParams {
  position?: string;
  availableOnly?: boolean;
  nameContains?: string;
  minGames?: number;
  minMean?: number;
  maxCv?: number;
  /** Define new numeric columns via safe expressions, then orderBy them. */
  compute?: ComputedMetricDef[];
  orderBy?: SeasonAnalysisOrderBy;
  orderDir?: "asc" | "desc";
  limit?: number;
}

function rowVars(row: SeasonAnalysisRow): Record<string, number | null> {
  const vars: Record<string, number | null> = {};
  for (const key of SEASON_ANALYSIS_EXPR_VARS) {
    vars[key] = row[key];
  }
  return vars;
}

function sortValue(
  row: SeasonAnalysisRow,
  orderBy: string,
): number | string | null {
  if (row.computed && Object.prototype.hasOwnProperty.call(row.computed, orderBy)) {
    return row.computed[orderBy] ?? null;
  }
  if ((SEASON_ANALYSIS_COLUMNS as readonly string[]).includes(orderBy)) {
    const v = row[orderBy as keyof SeasonAnalysisRow];
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "object" && v !== null) return null;
    return v as number | string | null;
  }
  return null;
}

export type AnalyzeSeasonPlayersResult =
  | { ok: true; players: SeasonAnalysisRow[]; computeErrors?: string[] }
  | { ok: false; error: string };

/**
 * Filter + sort season analysis rows. Supports agent-defined compute expressions.
 * Default order: consistencyScore desc (productive + steady = high mean/σ).
 */
export function analyzeSeasonPlayers(
  rows: SeasonAnalysisRow[],
  params: AnalyzeSeasonPlayersParams = {},
): AnalyzeSeasonPlayersResult {
  const compute = params.compute ?? [];
  if (compute.length > 8) {
    return { ok: false, error: "At most 8 computed metrics allowed" };
  }
  for (const c of compute) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.as)) {
      return { ok: false, error: `Invalid compute alias: ${c.as}` };
    }
    if ((SEASON_ANALYSIS_COLUMNS as readonly string[]).includes(c.as)) {
      return { ok: false, error: `compute.as collides with built-in column: ${c.as}` };
    }
  }
  const aliasSet = new Set(compute.map((c) => c.as));
  if (aliasSet.size !== compute.length) {
    return { ok: false, error: "Duplicate compute.as names" };
  }

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

  const computeErrors: string[] = [];
  if (compute.length > 0) {
    out = out.map((row) => {
      const computed: Record<string, number | null> = {};
      const vars = rowVars(row);
      for (const def of compute) {
        const evaluated = evalSafeExpr(def.expr, vars, SEASON_ANALYSIS_EXPR_VARS);
        if (!evaluated.ok) {
          if (computeErrors.length < 5) {
            computeErrors.push(`${def.as}: ${evaluated.error}`);
          }
          computed[def.as] = null;
        } else {
          computed[def.as] = roundExpr(evaluated.value);
        }
      }
      return { ...row, computed };
    });
    if (computeErrors.length > 0 && out.every((r) =>
      compute.every((c) => r.computed?.[c.as] == null),
    )) {
      // All null because of parse errors — fail fast
      const first = computeErrors[0]!;
      if (first.includes("Unknown") || first.includes("Unexpected") || first.includes("Expected")) {
        return { ok: false, error: `Invalid compute expression — ${first}` };
      }
    }
  }

  const orderBy = params.orderBy ?? "consistencyScore";
  const knownOrder =
    (SEASON_ANALYSIS_COLUMNS as readonly string[]).includes(orderBy) ||
    aliasSet.has(orderBy);
  if (!knownOrder) {
    return {
      ok: false,
      error: `orderBy "${orderBy}" is not a built-in column or compute.as alias`,
    };
  }

  const dir =
    params.orderDir ??
    (orderBy === "cv" || orderBy === "stdev" || orderBy === "bustRate" ? "asc" : "desc");
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
  return {
    ok: true,
    players: out.slice(0, limit),
    computeErrors: computeErrors.length ? computeErrors : undefined,
  };
}
