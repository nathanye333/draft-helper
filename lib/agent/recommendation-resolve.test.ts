import { describe, expect, it } from "vitest";
import { applyStartSitOutcome } from "@/lib/agent/recommendation-resolve-logic";

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
