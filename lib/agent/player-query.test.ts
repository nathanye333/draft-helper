import { describe, expect, it } from "vitest";
import {
  aggregatePlayers,
  findPlayersByNameOrId,
  findValuePlays,
  queryPlayers,
  type PlayerRow,
} from "./player-query";

function row(partial: Partial<PlayerRow> & Pick<PlayerRow, "fpPlayerId" | "name" | "position">): PlayerRow {
  return {
    nflTeam: null,
    byeWeek: null,
    draftYear: null,
    rankAdp: null,
    rankEcr: null,
    rankMin: null,
    rankMax: null,
    rankStd: null,
    tier: null,
    projPoints: null,
    adpValue: null,
    passYds: null,
    passTds: null,
    rushYds: null,
    rushTds: null,
    receptions: null,
    recYds: null,
    recTds: null,
    projStats: null,
    available: true,
    draftedBy: null,
    pickNumber: null,
    ...partial,
  };
}

const rows: PlayerRow[] = [
  row({
    fpPlayerId: "1",
    name: "Saquon Barkley",
    position: "RB",
    nflTeam: "PHI",
    byeWeek: 9,
    rankAdp: 2,
    rankEcr: 1,
    tier: 1,
    projPoints: 280,
    adpValue: 1,
    rushYds: 1200,
    available: true,
  }),
  row({
    fpPlayerId: "2",
    name: "Jahmyr Gibbs",
    position: "RB",
    nflTeam: "DET",
    byeWeek: 5,
    rankAdp: 5,
    rankEcr: 4,
    tier: 1,
    projPoints: 250,
    adpValue: 1,
    available: false,
    draftedBy: "Team A",
    pickNumber: 3,
  }),
  row({
    fpPlayerId: "3",
    name: "CeeDee Lamb",
    position: "WR",
    nflTeam: "DAL",
    byeWeek: 7,
    rankAdp: 6,
    rankEcr: 5,
    tier: 2,
    projPoints: 240,
    adpValue: 1,
    receptions: 110,
    available: true,
  }),
  row({
    fpPlayerId: "4",
    name: "Justin Jefferson",
    position: "WR",
    nflTeam: "MIN",
    byeWeek: 6,
    rankAdp: 4,
    rankEcr: 3,
    tier: 1,
    projPoints: 260,
    adpValue: 1,
    available: true,
  }),
  row({
    fpPlayerId: "5",
    name: "Patrick Mahomes",
    position: "QB",
    nflTeam: "KC",
    byeWeek: 10,
    rankAdp: 40,
    rankEcr: 25,
    tier: 4,
    projPoints: 320,
    adpValue: 15,
    passYds: 4500,
    available: true,
  }),
];

describe("queryPlayers", () => {
  it("filters available RBs under an ADP ceiling ordered by ADP", () => {
    const result = queryPlayers(rows, {
      position: "RB",
      availableOnly: true,
      adpMax: 10,
      orderBy: "adp",
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Saquon Barkley");
  });

  it("sorts by projected points descending", () => {
    const result = queryPlayers(rows, {
      availableOnly: true,
      orderBy: "projPoints",
      orderDir: "desc",
      limit: 3,
    });
    expect(result.map((r) => r.name)).toEqual([
      "Patrick Mahomes",
      "Saquon Barkley",
      "Justin Jefferson",
    ]);
  });

  it("filters and sorts by NFL draft year", () => {
    const withYears = [
      row({ fpPlayerId: "10", name: "Rookie A", position: "RB", draftYear: 2025, rankAdp: 20 }),
      row({ fpPlayerId: "11", name: "Vet B", position: "RB", draftYear: 2019, rankAdp: 15 }),
      row({ fpPlayerId: "12", name: "Mid C", position: "WR", draftYear: 2022, rankAdp: 30 }),
    ];
    const rookies = queryPlayers(withYears, { draftYearMin: 2024, orderBy: "draftYear", orderDir: "desc" });
    expect(rookies.map((r) => r.name)).toEqual(["Rookie A"]);
    const byYear = queryPlayers(withYears, { orderBy: "draftYear", orderDir: "asc", limit: 3 });
    expect(byYear.map((r) => r.draftYear)).toEqual([2019, 2022, 2025]);
  });
});

describe("aggregatePlayers", () => {
  it("groups available players by position with ADP stats", () => {
    const buckets = aggregatePlayers(rows, { groupBy: "position", availableOnly: true, metric: "adp" });
    const wr = buckets.find((b) => b.key === "WR");
    const rb = buckets.find((b) => b.key === "RB");

    expect(wr?.count).toBe(2);
    expect(wr?.metricMin).toBe(4);
    expect(wr?.metricMax).toBe(6);
    expect(rb?.count).toBe(1);
    expect(rb?.metricMin).toBe(2);
  });
});

describe("findPlayersByNameOrId", () => {
  it("matches by id and fuzzy name", () => {
    expect(findPlayersByNameOrId(rows, "3")[0].name).toBe("CeeDee Lamb");
    expect(findPlayersByNameOrId(rows, "mah")[0].name).toBe("Patrick Mahomes");
  });
});

describe("findValuePlays", () => {
  it("surfaces available players with large ADP−ECR gaps", () => {
    const result = findValuePlays(rows, { minAdpValue: 5 });
    expect(result[0].name).toBe("Patrick Mahomes");
    expect(result[0].adpValue).toBe(15);
  });
});
