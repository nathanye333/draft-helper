/**
 * Root-cause analysis for season-agent recommendation outcomes.
 * Classifies failures as skill gap vs chance vs lack of information.
 */

export type RcaCategory = "skill_gap" | "chance" | "lack_of_information";

export interface StartSitRcaInput {
  status: "validated" | "invalidated";
  lowestStarterActual: number;
  bestBenchActual: number;
  lowestStarterProjected: number | null;
  bestBenchProjected: number | null;
  /** Injury status on the low starter at resolve time (ESPN). */
  lowestStarterInjury?: string | null;
  /** Injury status on the best bench player at resolve time. */
  bestBenchInjury?: string | null;
  /** Points gap used to invalidate (bench - lowest starter). */
  actualGap: number;
  invalidateThreshold: number;
}

export interface RcaResult {
  category: RcaCategory | null;
  notes: string | null;
  evidence: Record<string, unknown>;
  tags: string[];
}

const OUT_STATUSES = new Set([
  "out",
  "o",
  "ir",
  "injured reserve",
  "doubtful",
  "d",
]);

function normalizeInjury(status: string | null | undefined): string | null {
  if (!status) return null;
  return status.trim().toLowerCase();
}

function isSevereInjury(status: string | null | undefined): boolean {
  const n = normalizeInjury(status);
  if (!n) return false;
  return OUT_STATUSES.has(n) || n.includes("out") || n.includes("ir");
}

/**
 * Classify a start/sit outcome.
 * Validated claims get null RCA (success). Invalidated claims always get a category.
 */
export function classifyStartSitRca(input: StartSitRcaInput): RcaResult {
  if (input.status === "validated") {
    return {
      category: null,
      notes: null,
      evidence: { status: "validated" },
      tags: [],
    };
  }

  const {
    lowestStarterActual,
    bestBenchActual,
    lowestStarterProjected,
    bestBenchProjected,
    lowestStarterInjury,
    bestBenchInjury,
    actualGap,
    invalidateThreshold,
  } = input;

  const evidence: Record<string, unknown> = {
    lowestStarterActual,
    bestBenchActual,
    lowestStarterProjected,
    bestBenchProjected,
    lowestStarterInjury: lowestStarterInjury ?? null,
    bestBenchInjury: bestBenchInjury ?? null,
    actualGap,
    invalidateThreshold,
  };

  // Knowable injury miss: starter ended near-zero with OUT/IR-like status.
  if (
    isSevereInjury(lowestStarterInjury) &&
    lowestStarterActual <= 1.5 &&
    bestBenchActual >= lowestStarterActual + invalidateThreshold
  ) {
    return {
      category: "skill_gap",
      notes:
        "Starter finished inactive/near-zero with a severe injury status; injury should have been checked before locking the lineup.",
      evidence,
      tags: ["rca:skill_gap", "injury_not_accounted"],
    };
  }

  // Missing projection data → cannot judge process quality.
  if (lowestStarterProjected == null || bestBenchProjected == null) {
    return {
      category: "lack_of_information",
      notes:
        "Missing projected points for starter and/or bench at resolve time; cannot separate skill from variance.",
      evidence,
      tags: ["rca:lack_of_information", "missing_projections"],
    };
  }

  const projDelta = bestBenchProjected - lowestStarterProjected;
  evidence.projDelta = projDelta;

  // Tools already preferred the bench player — recommendation ignored available signal.
  if (projDelta >= invalidateThreshold) {
    return {
      category: "skill_gap",
      notes: `Projections favored bench by ${projDelta.toFixed(1)} (threshold ${invalidateThreshold}); start/sit ignored available numbers.`,
      evidence,
      tags: ["rca:skill_gap", "ignored_projections"],
    };
  }

  // Projections favored the starter (or were close) but actuals flipped → variance.
  if (projDelta <= -invalidateThreshold) {
    return {
      category: "chance",
      notes: `Projections favored starter by ${(-projDelta).toFixed(1)}; actuals flipped (gap ${actualGap.toFixed(1)}). Process looked sound — variance.`,
      evidence,
      tags: ["rca:chance", "projection_correct_actual_wrong"],
    };
  }

  // Close projections: coin-flip that went wrong.
  return {
    category: "chance",
    notes: `Projections were close (bench−starter ${projDelta.toFixed(1)}); outcome was within normal variance.`,
    evidence,
    tags: ["rca:chance", "coin_flip"],
  };
}

/** Waiver RCA: acquisition tracking is weak signal; mostly lack_of_information. */
export function classifyWaiverRca(params: {
  status: "validated" | "invalidated" | "inconclusive";
  acquiredCount: number;
  targetCount: number;
}): RcaResult {
  if (params.status === "validated") {
    return { category: null, notes: null, evidence: params, tags: [] };
  }
  if (params.status === "inconclusive" && params.acquiredCount === 0) {
    return {
      category: "lack_of_information",
      notes:
        "Targets never acquired — cannot verify on-field outcome; may be user choice, FAAB, or timing rather than skill.",
      evidence: params,
      tags: ["rca:lack_of_information", "never_acquired"],
    };
  }
  return {
    category: "lack_of_information",
    notes: "Waiver outcomes are noisy without pickup + points timing.",
    evidence: params,
    tags: ["rca:lack_of_information"],
  };
}
