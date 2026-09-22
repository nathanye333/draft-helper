import { describe, expect, it } from "vitest";
import { applyStartSitOutcome } from "@/lib/agent/recommendation-resolve-logic";
import {
  classifyStartSitRca,
  classifyWaiverRca,
} from "@/lib/agent/recommendation-rca";

describe("start/sit outcome logic", () => {
  it("invalidates when bench beats lowest starter by threshold", () => {
    const result = applyStartSitOutcome({
      starterIds: [1, 2],
      benchIds: [3],
      actualById: new Map([
        [1, 8],
        [2, 12],
        [3, 15],
      ]),
      threshold: 3,
    });
    expect(result.status).toBe("invalidated");
    expect(result.failureTags).toContain("bench_outscored_starter");
    expect(result.lowestStarterId).toBe(1);
    expect(result.bestBenchId).toBe(3);
    expect(result.actualGap).toBe(7);
  });

  it("validates when starters hold", () => {
    const result = applyStartSitOutcome({
      starterIds: [1, 2],
      benchIds: [3],
      actualById: new Map([
        [1, 14],
        [2, 12],
        [3, 9],
      ]),
      threshold: 3,
    });
    expect(result.status).toBe("validated");
  });

  it("returns awaiting when no actuals", () => {
    const result = applyStartSitOutcome({
      starterIds: [1],
      benchIds: [2],
      actualById: new Map(),
      threshold: 3,
    });
    expect(result.status).toBe("awaiting_sync");
  });
});

describe("start/sit RCA", () => {
  const baseInvalidated = {
    status: "invalidated" as const,
    lowestStarterActual: 5,
    bestBenchActual: 14,
    actualGap: 9,
    invalidateThreshold: 3,
  };

  it("returns null RCA on validated", () => {
    const rca = classifyStartSitRca({
      ...baseInvalidated,
      status: "validated",
      lowestStarterProjected: 12,
      bestBenchProjected: 10,
    });
    expect(rca.category).toBeNull();
  });

  it("tags skill_gap when projections favored the bench", () => {
    const rca = classifyStartSitRca({
      ...baseInvalidated,
      lowestStarterProjected: 8,
      bestBenchProjected: 14,
    });
    expect(rca.category).toBe("skill_gap");
    expect(rca.tags).toContain("ignored_projections");
  });

  it("tags chance when projections favored the starter", () => {
    const rca = classifyStartSitRca({
      ...baseInvalidated,
      lowestStarterProjected: 14,
      bestBenchProjected: 9,
    });
    expect(rca.category).toBe("chance");
    expect(rca.tags).toContain("projection_correct_actual_wrong");
  });

  it("tags chance on close projections", () => {
    const rca = classifyStartSitRca({
      ...baseInvalidated,
      lowestStarterProjected: 11,
      bestBenchProjected: 12,
    });
    expect(rca.category).toBe("chance");
    expect(rca.tags).toContain("coin_flip");
  });

  it("tags lack_of_information when projections missing", () => {
    const rca = classifyStartSitRca({
      ...baseInvalidated,
      lowestStarterProjected: null,
      bestBenchProjected: null,
    });
    expect(rca.category).toBe("lack_of_information");
  });

  it("tags skill_gap for inactive injured starter", () => {
    const rca = classifyStartSitRca({
      ...baseInvalidated,
      lowestStarterActual: 0,
      bestBenchActual: 12,
      actualGap: 12,
      lowestStarterProjected: 15,
      bestBenchProjected: 10,
      lowestStarterInjury: "Out",
    });
    expect(rca.category).toBe("skill_gap");
    expect(rca.tags).toContain("injury_not_accounted");
  });
});

describe("waiver RCA", () => {
  it("marks never-acquired as lack_of_information", () => {
    const rca = classifyWaiverRca({
      status: "inconclusive",
      acquiredCount: 0,
      targetCount: 3,
    });
    expect(rca.category).toBe("lack_of_information");
  });
});
