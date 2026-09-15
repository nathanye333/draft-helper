/** Pure start/sit outcome scoring (extracted for unit tests). */

export function applyStartSitOutcome(params: {
  starterIds: number[];
  benchIds: number[];
  actualById: Map<number, number | null>;
  threshold: number;
}): {
  status: "validated" | "invalidated" | "awaiting_sync";
  outcomeScore: number | null;
  outcomeNotes: string;
  failureTags: string[];
} {
  const { starterIds, benchIds, actualById, threshold } = params;
  const allIds = [...new Set([...starterIds, ...benchIds])];
  const hasAnyActual = allIds.some((id) => actualById.get(id) != null);
  if (!hasAnyActual) {
    return {
      status: "awaiting_sync",
      outcomeScore: null,
      outcomeNotes: "No actual points yet",
      failureTags: [],
    };
  }

  let starterPts = 0;
  let starterCount = 0;
  let lowestStarter = Infinity;
  for (const id of starterIds) {
    const pts = actualById.get(id);
    if (pts != null) {
      starterPts += pts;
      starterCount += 1;
      if (pts < lowestStarter) lowestStarter = pts;
    }
  }

  let bestBench = -Infinity;
  let bestBenchId: number | null = null;
  for (const id of benchIds) {
    const pts = actualById.get(id);
    if (pts != null && pts > bestBench) {
      bestBench = pts;
      bestBenchId = id;
    }
  }

  const wrong =
    bestBenchId != null &&
    Number.isFinite(lowestStarter) &&
    bestBench - lowestStarter >= threshold;

  const outcomeScore = starterCount > 0 ? starterPts / starterCount : null;

  return {
    status: wrong ? "invalidated" : "validated",
    outcomeScore,
    outcomeNotes: wrong
      ? `Bench player ${bestBenchId} scored ${bestBench.toFixed(1)} vs lowest starter ${lowestStarter.toFixed(1)}`
      : `Starters averaged ${outcomeScore?.toFixed(1) ?? "n/a"} actual points`,
    failureTags: wrong ? ["bench_outscored_starter"] : [],
  };
}
