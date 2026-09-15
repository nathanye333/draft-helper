import { describe, expect, it } from "vitest";
import {
  computeSeasonCompositeScore,
  scoreSkillAgainstFixtures,
  SEASON_GOLDEN_FIXTURES,
} from "@/lib/agent/season-eval";
import {
  detectFollowUpRequired,
  extractClaimsFromToolCalls,
} from "@/lib/agent/recommendation-ledger";
import { renderSeasonSkill } from "@/lib/agent/season-skill";

describe("season-eval fixtures", () => {
  it("scores the seed skill reasonably high", () => {
    const seed = [
      "suggest_start_sit",
      "do not ask follow-up",
      "waiver_targets",
      "evaluate_trade",
      "do not invent",
      "tools",
      "analysis_schema",
      "web_search",
      "read-only",
      "Completed week fantasy scores",
    ].join("\n");
    const { average, results } = scoreSkillAgainstFixtures(seed);
    expect(results.length).toBe(SEASON_GOLDEN_FIXTURES.length);
    expect(average).toBeGreaterThan(0.7);
  });

  it("penalizes missing procedures", () => {
    const { average } = scoreSkillAgainstFixtures("You are helpful.");
    expect(average).toBeLessThan(0.2);
  });

  it("computes composite in 0..1", () => {
    const { score, breakdown } = computeSeasonCompositeScore({
      thumbsUpRate: 0.8,
      recommendationHitRate: 0.7,
      followUpRate: 0.1,
      latencyScore: 0.9,
      toolSuccessRate: 0.95,
      fixtureScore: 0.85,
    });
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThanOrEqual(1);
    expect(Object.keys(breakdown).length).toBe(6);
  });
});

describe("recommendation-ledger helpers", () => {
  it("detects follow-up questions", () => {
    expect(detectFollowUpRequired("Would you like me to check waivers?")).toBe(true);
    expect(
      detectFollowUpRequired("Start Bijan over Jacobs. Bijan has the better matchup."),
    ).toBe(false);
  });

  it("extracts start/sit claims from tool output", () => {
    const claims = extractClaimsFromToolCalls({
      leagueId: "league-1",
      userId: "user-1",
      season: 2025,
      week: 3,
      skillVersion: 1,
      sourceMessageId: "msg-1",
      toolCalls: [
        {
          name: "suggest_start_sit",
          output: JSON.stringify({
            starters: [{ espnPlayerId: 1 }, { espnPlayerId: 2 }],
            bench: [{ espnPlayerId: 3 }],
          }),
        },
      ],
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].claimType).toBe("start_sit");
    expect(claims[0].playerIds).toEqual([1, 2]);
    expect((claims[0].payload as { benchEspnIds: number[] }).benchEspnIds).toEqual([3]);
  });
});

describe("renderSeasonSkill", () => {
  it("injects league id", () => {
    expect(renderSeasonSkill("League id: {{leagueId}}.", { leagueId: "abc" })).toBe(
      "League id: abc.",
    );
  });
});
