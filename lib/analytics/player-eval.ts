/**
 * Pure helpers for season-agent player evaluation:
 * current-week projections + recent season form + data-conflict flags.
 */

export interface PlayerWeekSample {
  week: number;
  actual: number | null;
  projected: number | null;
}

export type PlayerEvalFlag =
  | "missing_fp_week_proj"
  | "missing_espn_week_proj"
  | "fp_ros_conflicts_recent_form"
  | "fp_week_vs_espn_week_gap"
  | "sparse_season_sample"
  | "gappy_weekly_history";

export interface PlayerEvalInputs {
  /** League's current NFL week (1–18). */
  currentWeek: number | null;
  /** Approximate remaining regular-season weeks for ROS PPG (default 18). */
  seasonWeeks?: number;
  fpWeekProj: number | null;
  fpRosProj: number | null;
  espnWeekProj: number | null;
  /** Current-season weekly rows (week ≥ 1), any order. */
  seasonWeeksActuals: PlayerWeekSample[];
  /** How many completed weeks to include in recentAvg (default 3). */
  recentWindow?: number;
}

export interface PlayerFormSummary {
  seasonGames: number;
  seasonAvg: number | null;
  recentWeeks: PlayerWeekSample[];
  recentAvg: number | null;
  /** Completed weeks strictly before currentWeek with an actual. */
  completedActuals: number[];
}

export interface PlayerDataFlags {
  flags: PlayerEvalFlag[];
  notes: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * Summarize current-season actuals for completed weeks.
 * Excludes the active week (still in progress) from recent form.
 */
export function summarizeSeasonForm(params: {
  currentWeek: number | null;
  seasonWeeksActuals: PlayerWeekSample[];
  recentWindow?: number;
}): PlayerFormSummary {
  const window = params.recentWindow ?? 3;
  const currentWeek =
    params.currentWeek != null && params.currentWeek > 0 ? params.currentWeek : null;

  const completed = params.seasonWeeksActuals
    .filter((w) => w.week >= 1 && w.actual != null && Number.isFinite(w.actual))
    .filter((w) => currentWeek == null || w.week < currentWeek)
    .sort((a, b) => a.week - b.week);

  const completedActuals = completed.map((w) => w.actual as number);
  const recentWeeks = completed.slice(-window);
  const recentAvg = mean(recentWeeks.map((w) => w.actual as number));

  return {
    seasonGames: completed.length,
    seasonAvg: mean(completedActuals),
    recentWeeks,
    recentAvg,
    completedActuals,
  };
}

/**
 * Detect conflicts / gaps when FantasyPros and ESPN (or recent form) disagree.
 */
export function detectPlayerDataFlags(params: PlayerEvalInputs): PlayerDataFlags {
  const flags: PlayerEvalFlag[] = [];
  const notes: string[] = [];
  const currentWeek =
    params.currentWeek != null && params.currentWeek > 0 ? params.currentWeek : null;
  const form = summarizeSeasonForm({
    currentWeek,
    seasonWeeksActuals: params.seasonWeeksActuals,
    recentWindow: params.recentWindow,
  });

  if (currentWeek != null && params.fpWeekProj == null) {
    flags.push("missing_fp_week_proj");
    notes.push(
      `No FantasyPros week ${currentWeek} projection — do not treat missing week proj as proof the player is unusable.`,
    );
  }

  if (currentWeek != null && params.espnWeekProj == null) {
    flags.push("missing_espn_week_proj");
    notes.push(`No ESPN week ${currentWeek} projection in the synced player pool.`);
  }

  if (form.seasonGames < 2) {
    flags.push("sparse_season_sample");
    notes.push(
      `Only ${form.seasonGames} completed-week actual(s) this season — treat sample size cautiously.`,
    );
  }

  // Gaps in completed-week sequence (e.g. week 3 then week 6 with no 4–5).
  if (form.recentWeeks.length >= 2) {
    const weeks = form.recentWeeks.map((w) => w.week);
    for (let i = 1; i < weeks.length; i++) {
      if ((weeks[i] ?? 0) - (weeks[i - 1] ?? 0) > 1) {
        flags.push("gappy_weekly_history");
        notes.push(
          `Weekly actuals skip weeks (${weeks.join(", ")}) — flag the gap instead of dismissing recent production.`,
        );
        break;
      }
    }
  }

  // ROS implies far lower PPG than recent form (classic stale ROS for a hot starter).
  if (
    params.fpRosProj != null &&
    params.fpRosProj > 0 &&
    form.recentAvg != null &&
    form.recentAvg >= 10 &&
    currentWeek != null
  ) {
    const seasonWeeks = params.seasonWeeks ?? 18;
    const remaining = Math.max(1, seasonWeeks - currentWeek + 1);
    const impliedPpg = params.fpRosProj / remaining;
    if (impliedPpg < form.recentAvg * 0.45) {
      flags.push("fp_ros_conflicts_recent_form");
      notes.push(
        `FP ROS ${params.fpRosProj.toFixed(1)} implies ~${impliedPpg.toFixed(1)} PPG over ${remaining} weeks, but recent ${form.recentWeeks.length}-week avg is ${form.recentAvg.toFixed(1)} — prefer recent form / role confirmation over stale ROS.`,
      );
    }
  }

  if (
    params.fpWeekProj != null &&
    params.espnWeekProj != null &&
    Math.abs(params.fpWeekProj - params.espnWeekProj) >= 5
  ) {
    flags.push("fp_week_vs_espn_week_gap");
    notes.push(
      `FP week proj ${params.fpWeekProj.toFixed(1)} vs ESPN week proj ${params.espnWeekProj.toFixed(1)} (gap ≥ 5) — cite both and prefer the source matching role/news.`,
    );
  }

  return { flags, notes };
}

/**
 * Preferred one-week projection: FantasyPros current week, else ESPN week.
 */
export function preferredWeekProj(params: {
  fpWeekProj: number | null;
  espnWeekProj: number | null;
}): { value: number | null; source: "fantasypros" | "espn" | null } {
  if (params.fpWeekProj != null) return { value: params.fpWeekProj, source: "fantasypros" };
  if (params.espnWeekProj != null) return { value: params.espnWeekProj, source: "espn" };
  return { value: null, source: null };
}
