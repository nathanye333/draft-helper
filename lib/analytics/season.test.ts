import { describe, expect, it } from "vitest";
import { suggestStartSit } from "@/lib/analytics/start-sit";
import { evaluateTrade } from "@/lib/analytics/trade";
import { rankWaiverTargets } from "@/lib/analytics/waivers";
import type { LeagueRosterEntry } from "@/lib/supabase/types";

function entry(
  partial: Partial<LeagueRosterEntry> & {
    espn_player_id: number;
    player_name: string;
    position: string;
  },
): LeagueRosterEntry {
  return {
    id: String(partial.espn_player_id),
    league_id: "league",
    espn_team_id: 1,
    nfl_team: "KC",
    lineup_slot: "BENCH",
    injury_status: null,
    fp_player_id: String(partial.espn_player_id),
    updated_at: new Date().toISOString(),
    ...partial,
  };
}

const slots = [
  { slot_type: "QB" as const, count: 1 },
  { slot_type: "RB" as const, count: 2 },
  { slot_type: "WR" as const, count: 2 },
  { slot_type: "TE" as const, count: 1 },
  { slot_type: "FLEX" as const, count: 1 },
  { slot_type: "DST" as const, count: 1 },
  { slot_type: "K" as const, count: 1 },
  { slot_type: "BENCH" as const, count: 6 },
];

describe("suggestStartSit", () => {
  it("fills starters by weekly projection", () => {
    const roster = [
      entry({ espn_player_id: 1, player_name: "QB1", position: "QB", fp_player_id: "1" }),
      entry({ espn_player_id: 2, player_name: "RB1", position: "RB", fp_player_id: "2" }),
      entry({ espn_player_id: 3, player_name: "RB2", position: "RB", fp_player_id: "3" }),
      entry({ espn_player_id: 4, player_name: "RB3", position: "RB", fp_player_id: "4" }),
      entry({ espn_player_id: 5, player_name: "WR1", position: "WR", fp_player_id: "5" }),
      entry({ espn_player_id: 6, player_name: "WR2", position: "WR", fp_player_id: "6" }),
      entry({ espn_player_id: 7, player_name: "TE1", position: "TE", fp_player_id: "7" }),
      entry({ espn_player_id: 8, player_name: "DST1", position: "DST", fp_player_id: "8" }),
      entry({ espn_player_id: 9, player_name: "K1", position: "K", fp_player_id: "9" }),
    ];
    const weekProj = new Map<string, number | null>([
      ["1", 18],
      ["2", 16],
      ["3", 14],
      ["4", 12],
      ["5", 15],
      ["6", 13],
      ["7", 10],
      ["8", 8],
      ["9", 7],
    ]);
    const result = suggestStartSit({ roster, rosterSlots: slots, weekProjByFpId: weekProj });
    expect(result.starters).toHaveLength(9);
    expect(result.starters.some((s) => s.name === "RB3")).toBe(true); // flex
    expect(result.bench.some((b) => b.name === "RB3")).toBe(false);
  });
});

describe("evaluateTrade", () => {
  it("flags clear ROS upgrades as accept", () => {
    const yourRoster = [
      entry({ espn_player_id: 1, player_name: "Give", position: "RB", espn_team_id: 1 }),
    ];
    const theirRoster = [
      entry({ espn_player_id: 2, player_name: "Get", position: "RB", espn_team_id: 2 }),
    ];
    const result = evaluateTrade({
      yourRoster,
      theirRoster,
      give: [{ espnPlayerId: 1, name: "Give", position: "RB", rosProj: 80, weekProj: 10 }],
      get: [{ espnPlayerId: 2, name: "Get", position: "RB", rosProj: 120, weekProj: 14 }],
      yourEspnTeamId: 1,
      theirEspnTeamId: 2,
      rosterSlots: slots,
    });
    expect(result.rosDelta).toBe(40);
    expect(["accept", "lean_accept"]).toContain(result.verdict);
  });
});

describe("rankWaiverTargets", () => {
  it("boosts positions of need", () => {
    const yourRoster = [
      entry({ espn_player_id: 1, player_name: "QB", position: "QB" }),
      entry({ espn_player_id: 2, player_name: "RB", position: "RB" }),
    ];
    const targets = rankWaiverTargets({
      freeAgents: [
        {
          fpPlayerId: "a",
          name: "WR Add",
          position: "WR",
          nflTeam: "BUF",
          weekProj: 12,
          rosProj: 100,
        },
        {
          fpPlayerId: "b",
          name: "QB Add",
          position: "QB",
          nflTeam: "KC",
          weekProj: 20,
          rosProj: 300,
        },
      ],
      yourRoster,
      rosterSlots: slots,
      limit: 5,
    });
    expect(targets[0]?.position).toBe("WR");
  });
});
