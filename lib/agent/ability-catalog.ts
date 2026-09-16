/**
 * Ability catalog proposals for season-agent SkillOpt-Sleep.
 * Workflow abilities may auto-merge into the skill on gate pass.
 * Tool/schema abilities stay proposed until /admin approval.
 */

export type AbilityKind = "workflow" | "tool" | "schema";

export interface AbilityProposal {
  slug: string;
  title: string;
  description: string;
  abilityKind: AbilityKind;
  skillBullet: string | null;
  specJson: Record<string, unknown>;
  evidenceJson: Record<string, unknown>;
}

const MAX_ABILITIES_PER_SLEEP = 3;

/** Normalize to a stable slug. */
export function slugifyAbility(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function dedupeAbilityProposals(
  proposals: AbilityProposal[],
  existingSlugs: Set<string>,
): AbilityProposal[] {
  const seen = new Set(existingSlugs);
  const out: AbilityProposal[] = [];
  for (const p of proposals) {
    const slug = slugifyAbility(p.slug || p.title);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ ...p, slug });
    if (out.length >= MAX_ABILITIES_PER_SLEEP) break;
  }
  return out;
}

/**
 * Heuristic ability proposals from sleep evidence.
 * Prefer workflows (existing tools); emit tool/schema only when data is missing.
 */
export function proposeAbilitiesFromEvidence(evidence: {
  failureNotes: string[];
  recommendationHitRate: number | null;
  followUpRate: number | null;
  toolSuccessRate: number | null;
  thumbsUpRate: number | null;
}): AbilityProposal[] {
  const raw: AbilityProposal[] = [];
  const failures = evidence.failureNotes.join("\n");

  if (/bench_outscored_starter/i.test(failures)) {
    raw.push({
      slug: "start-sit-injury-matchup-check",
      title: "Start/sit: injury + matchup gate",
      description:
        "Before locking starters, cross-check injury status and defense matchup using existing tools.",
      abilityKind: "workflow",
      skillBullet:
        "Start/sit workflow: call get_my_roster (or suggest_start_sit), then verify injury_status and query_defense_matchups / get_player_matchup for borderline seats before recommending.",
      specJson: {},
      evidenceJson: { tags: ["bench_outscored_starter"], samples: evidence.failureNotes.slice(0, 5) },
    });
  }

  if ((evidence.recommendationHitRate ?? 1) < 0.45) {
    raw.push({
      slug: "cite-tool-numbers-over-narrative",
      title: "Prefer tool numbers over narrative",
      description:
        "When advice and tool outputs disagree, trust projections/consistency/matchups and cite them.",
      abilityKind: "workflow",
      skillBullet:
        "When narrative judgment conflicts with tool outputs, prefer projections, consistency, and matchup numbers from tools and cite the figures in the reply.",
      specJson: {},
      evidenceJson: {
        recommendationHitRate: evidence.recommendationHitRate,
        samples: evidence.failureNotes.slice(0, 5),
      },
    });
  }

  if ((evidence.followUpRate ?? 0) > 0.15) {
    raw.push({
      slug: "decisive-no-clarify-menus",
      title: "Decisive replies without clarify menus",
      description: "Reduce agent-asked follow-ups by stating assumptions and answering.",
      abilityKind: "workflow",
      skillBullet:
        "Never end with clarifying menus. If underspecified, state a short assumption (user team, current week) and give a clear recommendation.",
      specJson: {},
      evidenceJson: { followUpRate: evidence.followUpRate },
    });
  }

  if ((evidence.toolSuccessRate ?? 1) < 0.85) {
    raw.push({
      slug: "tool-error-fallback",
      title: "Tool error fallback path",
      description: "Retry simpler args or alternate tools; never invent numbers after failures.",
      abilityKind: "workflow",
      skillBullet:
        "If a tool errors, retry with simpler arguments or fall back to another tool; never invent ADP/ECR/projections after a tool failure.",
      specJson: {},
      evidenceJson: { toolSuccessRate: evidence.toolSuccessRate },
    });
  }

  // Missing-data signals → tool/schema proposals (never auto-implemented).
  if (/snap|opportunity|target share|air yards/i.test(failures)) {
    raw.push({
      slug: "player-opportunity-stats-tool",
      title: "Player opportunity stats tool",
      description: "Expose snap counts / target share for start-sit and waivers.",
      abilityKind: "tool",
      skillBullet: null,
      specJson: {
        suggestedTool: "get_player_opportunity",
        inputs: ["espnPlayerId or name", "season", "week?"],
        dataSource: "nflverse or ESPN player stats enrichment",
        rationale: "Failures mention opportunity metrics not available via current tools",
      },
      evidenceJson: { samples: evidence.failureNotes.filter((n) => /snap|opportunity|target/i.test(n)) },
    });
  }

  if (/red.?zone|goal.?line|td rate|touchdown/i.test(failures) && /invalidated|miss/i.test(failures)) {
    raw.push({
      slug: "red-zone-usage-schema",
      title: "Red-zone usage schema",
      description: "Persist red-zone carries/targets for scoring-dependent start-sit.",
      abilityKind: "schema",
      skillBullet: null,
      specJson: {
        suggestedTable: "player_red_zone_weeks",
        columns: ["espn_player_id", "season", "week", "rz_carries", "rz_targets", "rz_tds"],
        dataSource: "nflverse",
        rationale: "TD-driven misses suggest missing red-zone context",
      },
      evidenceJson: { samples: evidence.failureNotes.slice(0, 5) },
    });
  }

  if ((evidence.thumbsUpRate ?? 1) < 0.4 && (evidence.recommendationHitRate ?? 1) < 0.5) {
    raw.push({
      slug: "vegas-game-totals-tool",
      title: "Vegas game totals tool",
      description: "Lookup implied team totals / spread for matchup context.",
      abilityKind: "tool",
      skillBullet: null,
      specJson: {
        suggestedTool: "get_game_environment",
        inputs: ["nflTeam", "week", "season"],
        dataSource: "external odds feed or cached schedule enrichment",
        rationale: "Low thumbs + low rec hit rate; game environment often requested",
      },
      evidenceJson: {
        thumbsUpRate: evidence.thumbsUpRate,
        recommendationHitRate: evidence.recommendationHitRate,
      },
    });
  }

  return raw;
}

/** Workflow bullets that should be merged into the candidate skill before scoring. */
export function workflowBulletsForMerge(proposals: AbilityProposal[]): string[] {
  return proposals
    .filter((p) => p.abilityKind === "workflow" && p.skillBullet?.trim())
    .map((p) => p.skillBullet!.trim());
}
