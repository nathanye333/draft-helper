import { describe, expect, it } from "vitest";
import { getRoundForPick, getTeamPositionForPick } from "./snake";

describe("getRoundForPick", () => {
  it("computes round number for a 10-team draft", () => {
    expect(getRoundForPick(1, 10)).toBe(1);
    expect(getRoundForPick(10, 10)).toBe(1);
    expect(getRoundForPick(11, 10)).toBe(2);
    expect(getRoundForPick(20, 10)).toBe(2);
    expect(getRoundForPick(21, 10)).toBe(3);
  });
});

describe("getTeamPositionForPick", () => {
  it("goes forward 1..N in odd rounds and reverses N..1 in even rounds", () => {
    const numTeams = 10;
    // Round 1: 1,2,3,...,10
    expect(getTeamPositionForPick(1, numTeams)).toBe(1);
    expect(getTeamPositionForPick(5, numTeams)).toBe(5);
    expect(getTeamPositionForPick(10, numTeams)).toBe(10);
    // Round 2 (picks 11-20): 10,9,...,1
    expect(getTeamPositionForPick(11, numTeams)).toBe(10);
    expect(getTeamPositionForPick(15, numTeams)).toBe(6);
    expect(getTeamPositionForPick(20, numTeams)).toBe(1);
    // Round 3 (picks 21-30): back to 1..10
    expect(getTeamPositionForPick(21, numTeams)).toBe(1);
    expect(getTeamPositionForPick(30, numTeams)).toBe(10);
  });

  it("works for a small 4-team league", () => {
    expect(getTeamPositionForPick(1, 4)).toBe(1);
    expect(getTeamPositionForPick(4, 4)).toBe(4);
    expect(getTeamPositionForPick(5, 4)).toBe(4);
    expect(getTeamPositionForPick(8, 4)).toBe(1);
    expect(getTeamPositionForPick(9, 4)).toBe(1);
  });

  it("throws for invalid input", () => {
    expect(() => getTeamPositionForPick(0, 10)).toThrow();
    expect(() => getTeamPositionForPick(1, 0)).toThrow();
  });
});
