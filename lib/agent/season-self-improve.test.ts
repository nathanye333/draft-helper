import { describe, expect, it } from "vitest";
import {
  computeSeasonCompositeScore,
  effectiveThumbsScore,
  scoreSkillAgainstFixtures,
  sessionDepthScore,
  SEASON_GOLDEN_FIXTURES,
} from "@/lib/agent/season-eval";
import {
  detectFollowUpRequired,
  extractClaimsFromToolCalls,
} from "@/lib/agent/recommendation-ledger";
import { renderSeasonSkill } from "@/lib/agent/season-skill";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("season-eval fixtures", () => {
  it("scores the seed skill reasonably high", () => {
    const seed = readFileSync(
      join(process.cwd(), "skills", "season-agent.md"),
      "utf8",
    );
    const { average, results } = scoreSkillAgainstFixtures(seed);
    expect(results.length).toBe(SEASON_GOLDEN_FIXTURES.length);
    expect(average).toBeGreaterThan(0.7);
  });

  it("penalizes missing procedures", () => {
    const { average } = scoreSkillAgainstFixtures("You are helpful.");
    expect(average).toBeLessThan(0.2);
  });

  it("rewards week-verify and injury cross-check language", () => {
    const weak = [
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
      "season year",
    ].join("\n");
    const strong = `${weak}\nAlways verify the active week number.\nCross-check injury via web_search before finalizing.`;
    const before = scoreSkillAgainstFixtures(weak).average;
    const after = scoreSkillAgainstFixtures(strong).average;
    expect(after).toBeGreaterThan(before + 0.005);
  });

  it("computes composite in 0..1 with passive + thumbs coverage", () => {
    const { score, breakdown } = computeSeasonCompositeScore({
      thumbsUpRate: 0,
      feedbackCount: 3,
      turnCount: 8,
      thumbsDownRate: 1,
      recommendationHitRate: 0.7,
      followUpRate: 0.1,
      latencyScore: 0.9,
      toolSuccessRate: 0.95,
      continuedTurnRate: 0.7,
      sessionDepthScore: 0.6,
      fixtureScore: 0.85,
    });
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
    expect(breakdown.passive).toBeGreaterThan(0);
    expect(breakdown.thumbs).toBeGreaterThan(0);
    // Sparse all-downs must not zero the thumbs component.
    expect(breakdown.thumbs).toBeGreaterThan(0.1 * 0.2);
  });

  it("shrinks sparse thumbs toward neutral", () => {
    expect(effectiveThumbsScore(0, 3, 8)).toBeGreaterThan(0.25);
    expect(effectiveThumbsScore(0, 3, 8)).toBeLessThan(0.5);
    expect(effectiveThumbsScore(null, 0, 8)).toBe(0.5);
  });

  it("scores session depth", () => {
    expect(sessionDepthScore(1)).toBe(0);
    expect(sessionDepthScore(4)).toBe(1);
    expect(sessionDepthScore(null)).toBe(0.4);
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
