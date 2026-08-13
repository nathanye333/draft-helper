import { describe, expect, it } from "vitest";
import { matchesBoardFilters, type BoardFilterState } from "@/components/draft-room/player-board-filters";

const base = {
  position: "RB" as const,
  byeWeek: 9,
  nflTeam: "PHI",
};

describe("matchesBoardFilters", () => {
  it("passes when all filters are ALL", () => {
    const filters: BoardFilterState = { position: "ALL", byeWeek: "ALL", nflTeam: "ALL" };
    expect(matchesBoardFilters(base, filters)).toBe(true);
  });

  it("filters by position, bye week, and NFL team", () => {
    expect(
      matchesBoardFilters(base, { position: "WR", byeWeek: "ALL", nflTeam: "ALL" }),
    ).toBe(false);
    expect(
      matchesBoardFilters(base, { position: "RB", byeWeek: 5, nflTeam: "ALL" }),
    ).toBe(false);
    expect(
      matchesBoardFilters(base, { position: "RB", byeWeek: 9, nflTeam: "DAL" }),
    ).toBe(false);
    expect(
      matchesBoardFilters(base, { position: "RB", byeWeek: 9, nflTeam: "PHI" }),
    ).toBe(true);
  });
});
