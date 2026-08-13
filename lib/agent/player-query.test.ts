import { describe, expect, it } from "vitest";
import {
  aggregatePlayers,
  findPlayersByNameOrId,
  queryPlayers,
  type PlayerRow,
} from "./player-query";

const rows: PlayerRow[] = [
  {
    fpPlayerId: "1",
    name: "Saquon Barkley",
    position: "RB",
    nflTeam: "PHI",
    byeWeek: 9,
    rankAdp: 2,
    rankEcr: 1,
    tier: 1,
    available: true,
    draftedBy: null,
    pickNumber: null,
  },
  {
    fpPlayerId: "2",
    name: "Jahmyr Gibbs",
    position: "RB",
    nflTeam: "DET",
    byeWeek: 5,
    rankAdp: 5,
    rankEcr: 4,
    tier: 1,
    available: false,
    draftedBy: "Team A",
    pickNumber: 3,
  },
  {
    fpPlayerId: "3",
    name: "CeeDee Lamb",
    position: "WR",
    nflTeam: "DAL",
    byeWeek: 7,
    rankAdp: 6,
    rankEcr: 5,
    tier: 2,
    available: true,
    draftedBy: null,
    pickNumber: null,
  },
  {
    fpPlayerId: "4",
    name: "Justin Jefferson",
    position: "WR",
    nflTeam: "MIN",
    byeWeek: 6,
    rankAdp: 4,
    rankEcr: 3,
    tier: 1,
    available: true,
    draftedBy: null,
    pickNumber: null,
  },
  {
    fpPlayerId: "5",
    name: "Patrick Mahomes",
    position: "QB",
    nflTeam: "KC",
    byeWeek: 10,
    rankAdp: 40,
    rankEcr: 35,
    tier: 4,
    available: true,
    draftedBy: null,
    pickNumber: null,
  },
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

  it("supports name substring and ecr ordering", () => {
    const result = queryPlayers(rows, {
      nameContains: "jeff",
      orderBy: "ecr",
    });
    expect(result.map((r) => r.name)).toEqual(["Justin Jefferson"]);
  });
});

describe("aggregatePlayers", () => {
  it("groups available players by position with ADP stats", () => {
    const buckets = aggregatePlayers(rows, { groupBy: "position", availableOnly: true });
    const wr = buckets.find((b) => b.key === "WR");
    const rb = buckets.find((b) => b.key === "RB");

    expect(wr?.count).toBe(2);
    expect(wr?.adpMin).toBe(4);
    expect(wr?.adpMax).toBe(6);
    expect(rb?.count).toBe(1);
    expect(rb?.adpMin).toBe(2);
  });
});

describe("findPlayersByNameOrId", () => {
  it("matches by id and fuzzy name", () => {
    expect(findPlayersByNameOrId(rows, "3")[0].name).toBe("CeeDee Lamb");
    expect(findPlayersByNameOrId(rows, "mah")[0].name).toBe("Patrick Mahomes");
  });
});
