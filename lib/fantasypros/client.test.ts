import { describe, expect, it } from "vitest";
import { scoringAwareProjectedPoints } from "./client";

describe("scoringAwareProjectedPoints", () => {
  const stats = { points: 100, points_half: 120, points_ppr: 140, rush_yds: 800 };

  it("picks the points field for the scoring format", () => {
    expect(scoringAwareProjectedPoints(stats, "STD")).toBe(100);
    expect(scoringAwareProjectedPoints(stats, "HALF")).toBe(120);
    expect(scoringAwareProjectedPoints(stats, "PPR")).toBe(140);
  });

  it("falls back to points when preferred key missing", () => {
    expect(scoringAwareProjectedPoints({ points: 90 }, "PPR")).toBe(90);
  });
});
