import { describe, expect, it } from "vitest";
import { evalSafeExpr } from "@/lib/analytics/safe-expr";

const allowed = ["mean", "stdev", "weekProj", "games"] as const;

describe("evalSafeExpr", () => {
  it("evaluates arithmetic and functions", () => {
    const r = evalSafeExpr("mean / max(stdev, 0.1)", { mean: 12, stdev: 2 }, allowed);
    expect(r).toEqual({ ok: true, value: 6 });

    const lift = evalSafeExpr("weekProj - mean", { weekProj: 18, mean: 12 }, allowed);
    expect(lift).toEqual({ ok: true, value: 6 });

    const abs = evalSafeExpr("abs(mean - weekProj)", { mean: 10, weekProj: 14 }, allowed);
    expect(abs).toEqual({ ok: true, value: 4 });
  });

  it("returns null for divide-by-zero or missing vars", () => {
    expect(evalSafeExpr("mean / stdev", { mean: 10, stdev: 0 }, allowed)).toEqual({
      ok: true,
      value: null,
    });
    expect(evalSafeExpr("mean / stdev", { mean: 10, stdev: null }, allowed)).toEqual({
      ok: true,
      value: null,
    });
    expect(evalSafeExpr("coalesce(stdev, 1)", { mean: 10, stdev: null }, allowed)).toEqual({
      ok: true,
      value: 1,
    });
  });

  it("rejects unknown variables and unsafe tokens", () => {
    expect(evalSafeExpr("mean + hacked", { mean: 1 }, allowed).ok).toBe(false);
    expect(evalSafeExpr("mean; process.exit()", { mean: 1 }, allowed).ok).toBe(false);
  });
});
