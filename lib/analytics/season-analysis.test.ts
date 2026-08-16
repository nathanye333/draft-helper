import { describe, expect, it } from "vitest";
import {
  analyzeSeasonPlayers,
  buildSeasonAnalysisRow,
} from "@/lib/analytics/season-analysis";
import {
  aggregateDefenseVsPosition,
  enrichDefenseRows,
  normalizeNflTeam,
} from "@/lib/nflverse/matchups-sync";
import { parseCsv } from "@/lib/nflverse/csv";

describe("normalizeNflTeam", () => {
  it("maps legacy abbreviations", () => {
    expect(normalizeNflTeam("la")).toBe("LAR");
    expect(normalizeNflTeam("WSH")).toBe("WAS");
    expect(normalizeNflTeam("SEA")).toBe("SEA");
  });
});

describe("aggregateDefenseVsPosition", () => {
  it("computes rush YPC allowed and fantasy points per game vs a defense", () => {
    const csv = [
      "season,week,season_type,position,opponent_team,carries,rushing_yards,fantasy_points,fantasy_points_ppr,attempts,passing_yards,targets,receptions,receiving_yards",
      "2024,1,REG,RB,SEA,20,80,12,14,0,0,0,0,0",
      "2024,2,REG,RB,SEA,20,60,8,9,0,0,0,0,0",
      "2024,1,REG,WR,SEA,0,0,10,15,0,0,5,4,60",
    ].join("\n");
    const rows = aggregateDefenseVsPosition(parseCsv(csv), 2024);
    const seaRb = rows.find((r) => r.defense_team === "SEA" && r.position === "RB");
    expect(seaRb).toBeTruthy();
    expect(seaRb!.games).toBe(2);
    expect(seaRb!.rush_ypc).toBe(3.5); // (80+60)/40
    expect(seaRb!.fant_pts_avg).toBe(10); // (12+8)/2

    const enriched = enrichDefenseRows(rows);
    const seaRbE = enriched.find((r) => r.defense_team === "SEA" && r.position === "RB");
    expect(seaRbE!.fant_pts_rank).toBe(1);
    expect(seaRbE!.rush_ypc_vs_avg).toBe(0); // only SEA RB in set
  });
});

describe("analyzeSeasonPlayers", () => {
  it("sorts by consistencyScore (mean/stdev) descending by default", () => {
    const steady = buildSeasonAnalysisRow({
      espnPlayerId: 1,
      name: "Steady",
      position: "RB",
      nflTeam: "KC",
      fantasyTeam: "A",
      available: true,
      weekActuals: [12, 13, 11, 12, 14, 12],
      weekProj: 12,
      rosProj: 150,
    });
    const boom = buildSeasonAnalysisRow({
      espnPlayerId: 2,
      name: "Boom",
      position: "RB",
      nflTeam: "CHI",
      fantasyTeam: "B",
      available: true,
      weekActuals: [3, 28, 2, 30, 4, 25],
      weekProj: 14,
      rosProj: 160,
    });
    expect(steady.consistencyScore).not.toBeNull();
    expect(boom.consistencyScore).not.toBeNull();
    expect(steady.consistencyScore!).toBeGreaterThan(boom.consistencyScore!);

    const ranked = analyzeSeasonPlayers([boom, steady], { minGames: 3, limit: 5 });
    expect(ranked.ok).toBe(true);
    if (ranked.ok) expect(ranked.players[0]!.name).toBe("Steady");
  });

  it("filters by position and minMean", () => {
    const rows = [
      buildSeasonAnalysisRow({
        espnPlayerId: 1,
        name: "WR1",
        position: "WR",
        nflTeam: "BUF",
        fantasyTeam: "A",
        available: true,
        weekActuals: [15, 16, 14, 15],
        weekProj: 15,
        rosProj: 180,
      }),
      buildSeasonAnalysisRow({
        espnPlayerId: 2,
        name: "RB1",
        position: "RB",
        nflTeam: "SF",
        fantasyTeam: "B",
        available: true,
        weekActuals: [8, 9, 7, 8],
        weekProj: 8,
        rosProj: 100,
      }),
    ];
    const result = analyzeSeasonPlayers(rows, { position: "WR", minMean: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.players).toHaveLength(1);
      expect(result.players[0]!.name).toBe("WR1");
    }
  });

  it("computes and sorts by a custom expression", () => {
    const highFloor = buildSeasonAnalysisRow({
      espnPlayerId: 1,
      name: "Floor",
      position: "WR",
      nflTeam: "BUF",
      fantasyTeam: "A",
      available: true,
      weekActuals: [14, 15, 13, 14, 15],
      weekProj: 12,
      rosProj: 160,
    });
    const upside = buildSeasonAnalysisRow({
      espnPlayerId: 2,
      name: "Upside",
      position: "WR",
      nflTeam: "MIA",
      fantasyTeam: "B",
      available: true,
      weekActuals: [8, 22, 7, 24, 9],
      weekProj: 18,
      rosProj: 170,
    });
    const result = analyzeSeasonPlayers([highFloor, upside], {
      minGames: 3,
      compute: [{ as: "projLift", expr: "weekProj - mean" }],
      orderBy: "projLift",
      orderDir: "desc",
      limit: 5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.players[0]!.name).toBe("Upside");
      expect(result.players[0]!.computed?.projLift).not.toBeNull();
      expect(result.players[0]!.computed!.projLift!).toBeGreaterThan(
        result.players[1]!.computed!.projLift!,
      );
    }
  });
});
