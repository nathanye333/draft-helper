/**
 * Season golden fixtures for held-out skill gating (SkillOpt-style).
 * Fixtures score whether the skill document encodes required procedures —
 * cheap, deterministic, no live LLM required for the gate core.
 */

export interface SeasonGoldenFixture {
  id: string;
  prompt: string;
  /** Substrings / phrases the skill should encourage (case-insensitive). */
  mustMention: string[];
  /** Anti-patterns the skill should discourage. */
  mustAvoid?: string[];
  weight: number;
}

export const SEASON_GOLDEN_FIXTURES: SeasonGoldenFixture[] = [
  {
    id: "start-sit-decisive",
    prompt: "Who should I start this week?",
    mustMention: ["suggest_start_sit", "do not ask follow-up"],
    mustAvoid: ["would you like"],
    weight: 1.2,
  },
  {
    id: "waiver-targets",
    prompt: "Who should I pick up on waivers?",
    mustMention: ["waiver_targets"],
    weight: 1,
  },
  {
    id: "trade-eval",
    prompt: "Should I trade my RB for their WR?",
    mustMention: ["evaluate_trade"],
    weight: 1,
  },
  {
    id: "use-tools-not-invent",
    prompt: "What are CMC's projections?",
    mustMention: ["do not invent", "tools"],
    weight: 1.1,
  },
  {
    id: "analysis-schema",
    prompt: "Run a custom SQL analysis of my roster variance",
    mustMention: ["analysis_schema"],
    weight: 0.9,
  },
  {
    id: "web-search-scoped",
    prompt: "Any injury news on my WR1?",
    mustMention: ["web_search"],
    weight: 0.8,
  },
  {
    id: "read-only",
    prompt: "Set my lineup on ESPN",
    mustMention: ["read-only"],
    weight: 0.7,
  },
  {
    id: "completed-weeks",
    prompt: "How did my team score last week?",
    mustMention: ["completed", "week"],
    weight: 0.8,
  },
];

export interface FixtureScore {
  id: string;
  score: number;
  hits: string[];
  misses: string[];
  avoidHits: string[];
}

export function scoreSkillAgainstFixtures(
  skillContent: string,
  fixtures: SeasonGoldenFixture[] = SEASON_GOLDEN_FIXTURES,
): { average: number; results: FixtureScore[] } {
  const text = skillContent.toLowerCase();
  const results: FixtureScore[] = [];
  let weighted = 0;
  let weightSum = 0;

  for (const f of fixtures) {
    const hits: string[] = [];
    const misses: string[] = [];
    const avoidHits: string[] = [];

    for (const phrase of f.mustMention) {
      if (text.includes(phrase.toLowerCase())) hits.push(phrase);
      else misses.push(phrase);
    }
    for (const phrase of f.mustAvoid ?? []) {
      if (text.includes(phrase.toLowerCase())) avoidHits.push(phrase);
    }

    const mentionScore = f.mustMention.length
      ? hits.length / f.mustMention.length
      : 1;
    const avoidPenalty = (f.mustAvoid?.length
      ? avoidHits.length / f.mustAvoid.length
      : 0) * 0.5;
    const score = Math.max(0, Math.min(1, mentionScore - avoidPenalty));

    results.push({ id: f.id, score, hits, misses, avoidHits });
    weighted += score * f.weight;
    weightSum += f.weight;
  }

  return {
    average: weightSum > 0 ? weighted / weightSum : 0,
    results,
  };
}

/** Composite gate used by SkillOpt-Sleep. */
export function computeSeasonCompositeScore(parts: {
  thumbsUpRate: number | null;
  recommendationHitRate: number | null;
  followUpRate: number | null;
  latencyScore: number | null;
  toolSuccessRate: number | null;
  fixtureScore: number;
}): { score: number; breakdown: Record<string, number> } {
  const thumbs = parts.thumbsUpRate ?? 0.5;
  const recs = parts.recommendationHitRate ?? 0.5;
  const followUps = 1 - (parts.followUpRate ?? 0.2);
  const latency = parts.latencyScore ?? 0.7;
  const tools = parts.toolSuccessRate ?? 0.8;
  const fixtures = parts.fixtureScore;

  const breakdown = {
    thumbs: 0.25 * thumbs,
    recommendations: 0.2 * recs,
    followUps: 0.15 * followUps,
    latency: 0.1 * latency,
    tools: 0.1 * tools,
    fixtures: 0.2 * fixtures,
  };

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown };
}
