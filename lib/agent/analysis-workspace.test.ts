import { describe, expect, it } from "vitest";
import { assertSafeAnalysisSql } from "@/lib/agent/analysis-workspace";

describe("assertSafeAnalysisSql", () => {
  it("allows select/with and scratch mutations", () => {
    expect(assertSafeAnalysisSql("SELECT * FROM nfl_player_weeks LIMIT 5")).toContain(
      "SELECT",
    );
    expect(
      assertSafeAnalysisSql(
        "CREATE TABLE scratch_x AS SELECT opponent_team, AVG(fantasy_points) AS avg_fp FROM nfl_player_weeks WHERE position='RB' GROUP BY opponent_team",
      ),
    ).toMatch(/^CREATE/i);
  });

  it("blocks multi-statement and dangerous ops", () => {
    expect(() => assertSafeAnalysisSql("SELECT 1; DROP TABLE season_players")).toThrow(
      /one SQL statement/i,
    );
    expect(() => assertSafeAnalysisSql("DELETE FROM season_players")).toThrow(/scratch_/i);
    expect(() => assertSafeAnalysisSql("ATTACH DATABASE 'x' AS y")).toThrow(/not allowed/i);
  });
});
