/**
 * Weekly fantasy-point consistency from ESPN actuals.
 * Callers should pass weekly games only (exclude week 0 season totals).
 */

export interface ConsistencyStats {
  games: number;
  mean: number | null;
  /** Sample standard deviation (n−1); null when games < 2. */
  stdev: number | null;
  /** Coefficient of variation = stdev / mean; null when mean ≤ 0 or stdev null. */
  cv: number | null;
  /** ~10th percentile of weekly actuals (floor). */
  floor: number | null;
  /** ~90th percentile of weekly actuals (ceiling). */
  ceiling: number | null;
  /** Share of weeks at or above boomThreshold. */
  boomRate: number | null;
  /** Share of weeks at or below bustThreshold. */
  bustRate: number | null;
  label: "consistent" | "volatile" | "boom_bust" | "unknown";
}

export interface ConsistencyOptions {
  /** Default 20 — strong WR/RB boom week in most formats. */
  boomThreshold?: number;
  /** Default 5 — clearly disappointing flex/starter week. */
  bustThreshold?: number;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const w = idx - lo;
  return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute consistency from weekly actual fantasy points.
 * Empty / single-game samples return label "unknown".
 */
export function computeConsistency(
  weekActuals: number[],
  options: ConsistencyOptions = {},
): ConsistencyStats {
  const boomThreshold = options.boomThreshold ?? 20;
  const bustThreshold = options.bustThreshold ?? 5;
  const samples = weekActuals.filter((n) => Number.isFinite(n));

  if (samples.length === 0) {
    return {
      games: 0,
      mean: null,
      stdev: null,
      cv: null,
      floor: null,
      ceiling: null,
      boomRate: null,
      bustRate: null,
      label: "unknown",
    };
  }

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  let stdev: number | null = null;
  if (samples.length >= 2) {
    const variance =
      samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (samples.length - 1);
    stdev = Math.sqrt(variance);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.1);
  const ceiling = percentile(sorted, 0.9);
  const boomRate = samples.filter((x) => x >= boomThreshold).length / samples.length;
  const bustRate = samples.filter((x) => x <= bustThreshold).length / samples.length;

  const cv = stdev != null && mean > 0 ? stdev / mean : null;

  let label: ConsistencyStats["label"] = "unknown";
  if (samples.length >= 3 && cv != null) {
    if (boomRate >= 0.25 && bustRate >= 0.25) label = "boom_bust";
    else if (cv <= 0.35) label = "consistent";
    else if (cv >= 0.55) label = "volatile";
    else label = "consistent"; // moderate CV — treat as usable starter consistency
  }

  return {
    games: samples.length,
    mean: round2(mean),
    stdev: stdev != null ? round2(stdev) : null,
    cv: cv != null ? round2(cv) : null,
    floor: round2(floor),
    ceiling: round2(ceiling),
    boomRate: round2(boomRate),
    bustRate: round2(bustRate),
    label,
  };
}

export function summarizeConsistency(name: string, stats: ConsistencyStats): string {
  if (stats.games === 0 || stats.mean == null) {
    return `${name}: no weekly actuals synced.`;
  }
  const parts = [
    `${name}: ${stats.games}g, avg ${stats.mean.toFixed(1)}`,
  ];
  if (stats.stdev != null) parts.push(`σ ${stats.stdev.toFixed(1)}`);
  if (stats.floor != null && stats.ceiling != null) {
    parts.push(`floor/ceil ${stats.floor.toFixed(1)}/${stats.ceiling.toFixed(1)}`);
  }
  if (stats.boomRate != null && stats.bustRate != null) {
    parts.push(
      `boom ${(stats.boomRate * 100).toFixed(0)}% / bust ${(stats.bustRate * 100).toFixed(0)}%`,
    );
  }
  parts.push(`(${stats.label})`);
  return parts.join(", ");
}

/** Average CV across players that have a CV (for trade side comparison). */
export function averageCv(
  statsList: ConsistencyStats[],
): number | null {
  const cvs = statsList.map((s) => s.cv).filter((c): c is number => c != null);
  if (cvs.length === 0) return null;
  return round2(cvs.reduce((a, b) => a + b, 0) / cvs.length);
}
