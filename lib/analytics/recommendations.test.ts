import { describe, expect, it } from "vitest";
import { computeRecommendations, picksUntilNextTurn } from "./recommendations";
import { DEFAULT_ROSTER_SLOTS } from "@/lib/supabase/types";

describe("picksUntilNextTurn", () => {
  it("computes picks remaining until this draft position is next up (snake)", () => {
    const numTeams = 10;
    // Position 1: picks at 1, 20, 21, 40, ...
    expect(picksUntilNextTurn(1, numTeams, 1)).toBe(19);
    expect(picksUntilNextTurn(19, numTeams, 1)).toBe(1);
    // Position 10: picks at 10, 11, 30, 31, ...
    expect(picksUntilNextTurn(10, numTeams, 10)).toBe(1);
  });
});

describe("computeRecommendations", () => {
  it("ranks a fallen ADP player with roster need above a filled-position elite", () => {
    const result = computeRecommendations({
      candidates: [
        // ADP 8 still there at pick 15 → +7 value, and RB starters empty
        { fpPlayerId: "rb1", name: "Falling RB", position: "RB", rankAdp: 8, rankEcr: 10 },
        { fpPlayerId: "qb1", name: "Elite QB", position: "QB", rankAdp: 12, rankEcr: 1 },
        // Deep sleeper must not win on inverted ADP math
        { fpPlayerId: "rb2", name: "Deep Sleeper", position: "RB", rankAdp: 400, rankEcr: 200 },
      ],
      currentPickNumber: 15,
      numTeams: 10,
      userDraftPosition: 3,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      userAssignedSlots: ["QB"], // QB already filled, RB slots empty
      limit: 10,
    });

    expect(result[0].fpPlayerId).toBe("rb1");
    expect(result[0].rationale).toContain("RB need");
    expect(result[0].rationale).toContain("ADP value");
    expect(result.find((r) => r.fpPlayerId === "rb2")!.score).toBeLessThan(result[0].score);
  });

  it("does not recommend deep sleepers over top ADP players early in the draft", () => {
    const result = computeRecommendations({
      candidates: [
        { fpPlayerId: "elite", name: "Elite RB", position: "RB", rankAdp: 3, rankEcr: 3 },
        { fpPlayerId: "sleeper", name: "Louis Sleeper", position: "RB", rankAdp: 600, rankEcr: 400 },
        { fpPlayerId: "kicker", name: "Random K", position: "K", rankAdp: 594, rankEcr: 50 },
      ],
      currentPickNumber: 5,
      numTeams: 10,
      userDraftPosition: 5,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      userAssignedSlots: [],
      limit: 3,
    });

    expect(result[0].fpPlayerId).toBe("elite");
    expect(result[0].rationale).not.toMatch(/\+\d{2,} ADP value/);
  });

  it("returns at most `limit` recommendations sorted by score descending", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      fpPlayerId: `p${i}`,
      name: `Player ${i}`,
      position: "WR" as const,
      rankAdp: i + 1,
      rankEcr: i + 1,
    }));

    const result = computeRecommendations({
      candidates,
      currentPickNumber: 5,
      numTeams: 10,
      userDraftPosition: 1,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      userAssignedSlots: [],
      limit: 5,
    });

    expect(result).toHaveLength(5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
    // Lowest ADP still available should rank first when need/scarcity are equal
    expect(result[0].fpPlayerId).toBe("p0");
  });
});
