import { describe, expect, it } from "vitest";
import {
  espnWeeklyStatAdditionalValues,
  parseEspnStatId,
} from "@/lib/espn/player-universe";
import { parseEspnMatchups } from "@/lib/espn/client";

describe("parseEspnStatId", () => {
  it("parses season totals and weekly actual/projected ids", () => {
    expect(parseEspnStatId("002026")).toEqual({
      seasonId: 2026,
      week: 0,
      statSourceId: 0,
    });
    expect(parseEspnStatId("0120261")).toEqual({
      seasonId: 2026,
      week: 1,
      statSourceId: 0,
    });
    expect(parseEspnStatId("1120262")).toEqual({
      seasonId: 2026,
      week: 2,
      statSourceId: 1,
    });
    expect(parseEspnStatId("01202610")).toEqual({
      seasonId: 2026,
      week: 10,
      statSourceId: 0,
    });
  });
});

describe("espnWeeklyStatAdditionalValues", () => {
  it("requests weekly actuals for every week through current", () => {
    expect(espnWeeklyStatAdditionalValues({ season: 2026, currentWeek: 2 })).toEqual([
      "002026",
      "102026",
      "002025",
      "102025",
      "0120261",
      "0120262",
      "1120262",
    ]);
  });

  it("clamps week 1 before kickoff-style currentWeek", () => {
    expect(espnWeeklyStatAdditionalValues({ season: 2026, currentWeek: 1 })[4]).toBe(
      "0120261",
    );
  });
});

describe("parseEspnMatchups", () => {
  it("keeps completed and upcoming weeks, not only current", () => {
    const schedule = [
      {
        matchupPeriodId: 1,
        home: { teamId: 1, totalPoints: 112.4 },
        away: { teamId: 2, totalPoints: 98.1 },
      },
      {
        matchupPeriodId: 2,
        home: { teamId: 1, totalPoints: 0 },
        away: { teamId: 3, totalPoints: 0 },
      },
      {
        matchupPeriodId: 1,
        home: { teamId: 4 },
        away: { teamId: 5, totalPoints: 88 },
      },
    ];
    const parsed = parseEspnMatchups(schedule);
    expect(parsed).toHaveLength(3);
    expect(parsed.filter((m) => m.week === 1)).toEqual([
      {
        week: 1,
        homeEspnTeamId: 1,
        awayEspnTeamId: 2,
        homePoints: 112.4,
        awayPoints: 98.1,
      },
      {
        week: 1,
        homeEspnTeamId: 4,
        awayEspnTeamId: 5,
        homePoints: null,
        awayPoints: 88,
      },
    ]);
    expect(parsed.find((m) => m.week === 2)?.homeEspnTeamId).toBe(1);
  });
});
