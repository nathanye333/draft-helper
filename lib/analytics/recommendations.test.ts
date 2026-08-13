import { describe, expect, it } from "vitest";
import { computeRecommendations, picksUntilNextTurn } from "./recommendations";
import { DEFAULT_ROSTER_SLOTS } from "@/lib/supabase/types";

describe("picksUntilNextTurn", () => {
  it("computes picks remaining until this draft position is next up (snake)", () => {
    const numTeams = 10;
    expect(picksUntilNextTurn(1, numTeams, 1)).toBe(19);
    expect(picksUntilNextTurn(19, numTeams, 1)).toBe(1);
    expect(picksUntilNextTurn(10, numTeams, 10)).toBe(1);
  });
});

describe("computeRecommendations", () => {
  it("ranks elite ADP over projection-only / null-ADP filler early", () => {
    const result = computeRecommendations({
      candidates: [
        { fpPlayerId: "elite", name: "Elite RB", position: "RB", rankAdp: 3, rankEcr: 3 },
        { fpPlayerId: "nullAdp", name: "Proj-only WR", position: "WR", rankAdp: null, rankEcr: null },
        { fpPlayerId: "deep", name: "Deep WR", position: "WR", rankAdp: 400, rankEcr: 350 },
      ],
      currentPickNumber: 5,
      numTeams: 10,
      userDraftPosition: 5,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      userAssignedSlots: [],
      limit: 5,
    });

    expect(result[0].fpPlayerId).toBe("elite");
    expect(result.map((r) => r.fpPlayerId)).not.toContain("nullAdp");
    expect(result.map((r) => r.fpPlayerId)).not.toContain("deep");
  });

  it("ranks a fallen ADP player with roster need above a filled-position elite", () => {
    const result = computeRecommendations({
      candidates: [
        { fpPlayerId: "rb1", name: "Falling RB", position: "RB", rankAdp: 8, rankEcr: 10 },
        { fpPlayerId: "qb1", name: "Elite QB", position: "QB", rankAdp: 12, rankEcr: 1 },
      ],
      currentPickNumber: 15,
      numTeams: 10,
      userDraftPosition: 3,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      userAssignedSlots: ["QB"],
      limit: 10,
    });

    expect(result[0].fpPlayerId).toBe("rb1");
    expect(result[0].rationale).toContain("RB need");
    expect(result[0].rationale).toContain("ADP");
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
    expect(result.map((r) => r.fpPlayerId)).not.toContain("sleeper");
  });

  it("returns recommendations sorted by score with best ADP first when need is equal", () => {
    const candidates = Array.from({ length: 40 }, (_, i) => ({
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
    expect(result[0].fpPlayerId).toBe("p0");
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it("boosts a player who has fallen past ADP", () => {
    const result = computeRecommendations({
      candidates: [
        { fpPlayerId: "fair", name: "On-ADP WR", position: "WR", rankAdp: 20, rankEcr: 22 },
        { fpPlayerId: "steal", name: "Fallen RB", position: "RB", rankAdp: 12, rankEcr: 11 },
      ],
      currentPickNumber: 25,
      numTeams: 10,
      userDraftPosition: 5,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      userAssignedSlots: [],
      limit: 2,
    });

    expect(result[0].fpPlayerId).toBe("steal");
    expect(result[0].rationale).toContain("value");
  });

  it("includes multiple QBs so position filters are not empty early", () => {
    const result = computeRecommendations({
      candidates: [
        { fpPlayerId: "rb1", name: "RB1", position: "RB", rankAdp: 1, rankEcr: 1 },
        { fpPlayerId: "wr1", name: "WR1", position: "WR", rankAdp: 2, rankEcr: 2 },
        { fpPlayerId: "qb1", name: "Josh Allen", position: "QB", rankAdp: 25, rankEcr: 30 },
        { fpPlayerId: "qb2", name: "Lamar Jackson", position: "QB", rankAdp: 35, rankEcr: 40 },
        { fpPlayerId: "qb3", name: "Jalen Hurts", position: "QB", rankAdp: 42, rankEcr: 45 },
        { fpPlayerId: "qb4", name: "Joe Burrow", position: "QB", rankAdp: 48, rankEcr: 50 },
      ],
      currentPickNumber: 5,
      numTeams: 10,
      userDraftPosition: 5,
      rosterSlots: DEFAULT_ROSTER_SLOTS,
      userAssignedSlots: [],
      limit: 20,
    });

    const qbs = result.filter((r) => r.position === "QB");
    expect(qbs.length).toBeGreaterThanOrEqual(3);
    expect(qbs.map((q) => q.fpPlayerId)).toContain("qb2");
  });
});
