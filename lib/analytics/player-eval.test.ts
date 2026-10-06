import { describe, expect, it } from "vitest";
import {
  detectPlayerDataFlags,
  preferredWeekProj,
  summarizeSeasonForm,
} from "@/lib/analytics/player-eval";

describe("summarizeSeasonForm", () => {
  it("averages completed weeks before the current week", () => {
    const form = summarizeSeasonForm({
      currentWeek: 5,
      seasonWeeksActuals: [
        { week: 1, actual: 20, projected: 18 },
        { week: 2, actual: 22, projected: 18 },
        { week: 3, actual: 24, projected: 18 },
        { week: 4, actual: null, projected: 19 },
        { week: 5, actual: null, projected: 19 },
      ],
      recentWindow: 3,
    });
    expect(form.seasonGames).toBe(3);
    expect(form.seasonAvg).toBe(22);
    expect(form.recentAvg).toBe(22);
    expect(form.recentWeeks.map((w) => w.week)).toEqual([1, 2, 3]);
  });

  it("excludes the in-progress current week even if an actual sneaks in", () => {
    const form = summarizeSeasonForm({
      currentWeek: 5,
      seasonWeeksActuals: [
        { week: 3, actual: 10, projected: null },
        { week: 4, actual: 12, projected: null },
        { week: 5, actual: 30, projected: null },
      ],
    });
    expect(form.recentWeeks.map((w) => w.week)).toEqual([3, 4]);
    expect(form.recentAvg).toBe(11);
  });
});

describe("detectPlayerDataFlags", () => {
  it("flags missing FP week proj and ROS vs hot recent form (Cousins-style)", () => {
    const { flags, notes } = detectPlayerDataFlags({
      currentWeek: 5,
      fpWeekProj: null,
      fpRosProj: 47.27,
      espnWeekProj: null,
      seasonWeeksActuals: [
        { week: 2, actual: 21, projected: null },
        { week: 3, actual: 23, projected: null },
        { week: 4, actual: 22, projected: null },
      ],
    });
    expect(flags).toContain("missing_fp_week_proj");
    expect(flags).toContain("fp_ros_conflicts_recent_form");
    expect(flags).toContain("missing_espn_week_proj");
    expect(notes.some((n) => /stale ROS|recent/i.test(n))).toBe(true);
  });

  it("flags gaps in weekly history instead of treating sample as empty", () => {
    const { flags } = detectPlayerDataFlags({
      currentWeek: 5,
      fpWeekProj: 18,
      fpRosProj: 200,
      espnWeekProj: 17,
      seasonWeeksActuals: [
        { week: 1, actual: 1.16, projected: null },
        { week: 3, actual: 20, projected: null },
        { week: 4, actual: 22, projected: null },
      ],
    });
    expect(flags).toContain("gappy_weekly_history");
    expect(flags).not.toContain("fp_ros_conflicts_recent_form");
  });

  it("flags large FP vs ESPN week projection gaps", () => {
    const { flags } = detectPlayerDataFlags({
      currentWeek: 5,
      fpWeekProj: 8,
      fpRosProj: 150,
      espnWeekProj: 19.5,
      seasonWeeksActuals: [
        { week: 1, actual: 15, projected: null },
        { week: 2, actual: 16, projected: null },
        { week: 3, actual: 14, projected: null },
      ],
    });
    expect(flags).toContain("fp_week_vs_espn_week_gap");
  });
});

describe("preferredWeekProj", () => {
  it("prefers FantasyPros when present", () => {
    expect(preferredWeekProj({ fpWeekProj: 19.4, espnWeekProj: 17 })).toEqual({
      value: 19.4,
      source: "fantasypros",
    });
  });

  it("falls back to ESPN when FP week is missing", () => {
    expect(preferredWeekProj({ fpWeekProj: null, espnWeekProj: 17 })).toEqual({
      value: 17,
      source: "espn",
    });
  });
});
