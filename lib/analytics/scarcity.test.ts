import { describe, expect, it } from "vitest";
import { computePositionScarcity } from "./scarcity";
import type { Position } from "@/lib/supabase/types";

function player(position: Position, rankAdp: number) {
  return { position, rankAdp };
}

describe("computePositionScarcity", () => {
  it("flags a run when a position is drafted faster than ADP suggests", () => {
    const rankings = [
      player("RB", 1),
      player("RB", 2),
      player("RB", 3),
      player("RB", 4),
      player("WR", 5),
    ];
    // At pick 4, ADP expects ~4 RBs gone; 4 have actually gone -> ratio 4/4 too, not run.
    // Simulate a run: all 4 ADP-eligible RBs plus extra taken early relative to pick 4.
    const drafted: Position[] = ["RB", "RB", "RB", "RB"];
    const result = computePositionScarcity(rankings, drafted, 4);
    const rb = result.find((r) => r.position === "RB")!;
    expect(rb.expectedCount).toBe(4);
    expect(rb.draftedCount).toBe(4);
    expect(rb.ratio).toBe(1);
    expect(rb.status).toBe("normal");
  });

  it("flags 'falling' when a position lags behind ADP expectations", () => {
    const rankings = [player("TE", 1), player("TE", 2), player("TE", 3), player("TE", 4)];
    const drafted: Position[] = ["TE"];
    const result = computePositionScarcity(rankings, drafted, 4);
    const te = result.find((r) => r.position === "TE")!;
    expect(te.expectedCount).toBe(4);
    expect(te.draftedCount).toBe(1);
    expect(te.ratio).toBe(0.25);
    expect(te.status).toBe("falling");
  });

  it("returns null ratio and 'normal' status when nothing is expected yet", () => {
    const result = computePositionScarcity([], [], 1);
    const qb = result.find((r) => r.position === "QB")!;
    expect(qb.expectedCount).toBe(0);
    expect(qb.ratio).toBeNull();
    expect(qb.status).toBe("normal");
  });
});
