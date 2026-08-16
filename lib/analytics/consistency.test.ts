import { describe, expect, it } from "vitest";
import {
  averageCv,
  computeConsistency,
  summarizeConsistency,
} from "@/lib/analytics/consistency";

describe("computeConsistency", () => {
  it("returns unknown for empty samples", () => {
    const stats = computeConsistency([]);
    expect(stats.games).toBe(0);
    expect(stats.label).toBe("unknown");
    expect(stats.mean).toBeNull();
  });

  it("computes mean and percentiles for steady scorer", () => {
    const stats = computeConsistency([12, 13, 11, 12, 14, 12, 13]);
    expect(stats.games).toBe(7);
    expect(stats.mean).toBeCloseTo(12.43, 1);
    expect(stats.stdev).not.toBeNull();
    expect(stats.cv!).toBeLessThan(0.35);
    expect(stats.label).toBe("consistent");
    expect(stats.floor!).toBeLessThanOrEqual(stats.mean!);
    expect(stats.ceiling!).toBeGreaterThanOrEqual(stats.mean!);
  });

  it("flags volatile / boom-bust profiles", () => {
    const volatile = computeConsistency([3, 28, 4, 30, 2, 25, 5]);
    expect(volatile.cv!).toBeGreaterThan(0.55);
    expect(["volatile", "boom_bust"]).toContain(volatile.label);

    const boomBust = computeConsistency([2, 22, 3, 24, 1, 21, 4, 23]);
    expect(boomBust.boomRate!).toBeGreaterThanOrEqual(0.25);
    expect(boomBust.bustRate!).toBeGreaterThanOrEqual(0.25);
    expect(boomBust.label).toBe("boom_bust");
  });

  it("needs at least 2 games for stdev", () => {
    const one = computeConsistency([15]);
    expect(one.mean).toBe(15);
    expect(one.stdev).toBeNull();
    expect(one.label).toBe("unknown");
  });
});

describe("summarizeConsistency", () => {
  it("formats a readable line", () => {
    const line = summarizeConsistency(
      "Player A",
      computeConsistency([10, 12, 11, 13, 12]),
    );
    expect(line).toContain("Player A");
    expect(line).toContain("5g");
    expect(line).toContain("consistent");
  });
});

describe("averageCv", () => {
  it("averages available CVs", () => {
    const a = computeConsistency([10, 11, 10, 12, 11]);
    const b = computeConsistency([5, 25, 4, 30, 6]);
    const avg = averageCv([a, b]);
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThan(a.cv!);
  });
});
