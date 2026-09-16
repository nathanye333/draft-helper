import { describe, expect, it } from "vitest";
import {
  dedupeAbilityProposals,
  proposeAbilitiesFromEvidence,
  slugifyAbility,
  workflowBulletsForMerge,
} from "@/lib/agent/ability-catalog";
import { computeSeasonCompositeScore } from "@/lib/agent/season-eval";

describe("ability-catalog", () => {
  it("slugifies titles stably", () => {
    expect(slugifyAbility("Start/Sit: Injury + Matchup")).toBe(
      "start-sit-injury-matchup",
    );
  });

  it("proposes workflow for bench_outscored_starter", () => {
    const proposals = proposeAbilitiesFromEvidence({
      failureNotes: [
        'start_sit: Bench player 3 scored 15.0 vs lowest starter 8.0 tags=["bench_outscored_starter"]',
      ],
      recommendationHitRate: 0.7,
      followUpRate: 0.05,
      toolSuccessRate: 0.95,
      thumbsUpRate: 0.8,
    });
    expect(proposals.some((p) => p.abilityKind === "workflow")).toBe(true);
    expect(
      proposals.some((p) => p.slug === "start-sit-injury-matchup-check"),
    ).toBe(true);
  });

  it("proposes tool/schema for missing-data style failures", () => {
    const proposals = proposeAbilitiesFromEvidence({
      failureNotes: [
        "start_sit: invalidated — missing snap counts / opportunity share",
        "waiver: invalidated — target share unknown",
      ],
      recommendationHitRate: 0.3,
      followUpRate: 0.05,
      toolSuccessRate: 0.9,
      thumbsUpRate: 0.35,
    });
    expect(proposals.some((p) => p.abilityKind === "tool")).toBe(true);
    const tools = proposals.filter((p) => p.abilityKind === "tool" || p.abilityKind === "schema");
    expect(tools.every((p) => p.skillBullet == null)).toBe(true);
  });

  it("dedupes by slug and caps at 3", () => {
    const raw = proposeAbilitiesFromEvidence({
      failureNotes: [
        'start_sit: tags=["bench_outscored_starter"] snap counts missing',
        "red zone td rate miss invalidated",
      ],
      recommendationHitRate: 0.2,
      followUpRate: 0.2,
      toolSuccessRate: 0.7,
      thumbsUpRate: 0.3,
    });
    expect(raw.length).toBeGreaterThan(3);
    const deduped = dedupeAbilityProposals(raw, new Set());
    expect(deduped.length).toBeLessThanOrEqual(3);
    const allSlugs = new Set(raw.map((p) => p.slug));
    expect(dedupeAbilityProposals(raw, allSlugs).length).toBe(0);
    const second = dedupeAbilityProposals(
      raw,
      new Set(deduped.map((p) => p.slug)),
    );
    expect(second.every((p) => !deduped.some((d) => d.slug === p.slug))).toBe(
      true,
    );
  });

  it("extracts workflow bullets for skill merge only", () => {
    const bullets = workflowBulletsForMerge([
      {
        slug: "a",
        title: "A",
        description: "",
        abilityKind: "workflow",
        skillBullet: "Do X with existing tools.",
        specJson: {},
        evidenceJson: {},
      },
      {
        slug: "b",
        title: "B",
        description: "",
        abilityKind: "tool",
        skillBullet: null,
        specJson: { suggestedTool: "foo" },
        evidenceJson: {},
      },
    ]);
    expect(bullets).toEqual(["Do X with existing tools."]);
  });
});

describe("composite reward unchanged", () => {
  it("keeps the same weights", () => {
    const { score, breakdown } = computeSeasonCompositeScore({
      thumbsUpRate: 1,
      recommendationHitRate: 1,
      followUpRate: 0,
      latencyScore: 1,
      toolSuccessRate: 1,
      fixtureScore: 1,
    });
    expect(breakdown.thumbs).toBeCloseTo(0.25);
    expect(breakdown.recommendations).toBeCloseTo(0.2);
    expect(breakdown.followUps).toBeCloseTo(0.15);
    expect(breakdown.latency).toBeCloseTo(0.1);
    expect(breakdown.tools).toBeCloseTo(0.1);
    expect(breakdown.fixtures).toBeCloseTo(0.2);
    expect(score).toBeCloseTo(1);
  });
});
