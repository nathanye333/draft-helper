import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeSeasonCompositeScore,
  scoreSkillAgainstFixtures,
} from "@/lib/agent/season-eval";
import {
  getActiveSeasonSkill,
  getNextSeasonSkillVersion,
  invalidateSeasonSkillCache,
  SEASON_SKILL_KIND,
} from "@/lib/agent/season-skill";

const MIN_EVIDENCE_TURNS = 5;
const MIN_RESOLVED_RECS = 3;
const MAX_EDIT_OPS = 4;
const DEFAULT_BUDGET_USD = 12;

export interface SkillSleepResult {
  skipped?: boolean;
  reason?: string;
  accepted?: boolean;
  fromVersion?: number;
  toVersion?: number;
  gateBefore?: number;
  gateAfter?: number;
  costEstimateUsd?: number;
}

interface EvidenceBundle {
  thumbsUpRate: number | null;
  recommendationHitRate: number | null;
  followUpRate: number | null;
  latencyScore: number | null;
  toolSuccessRate: number | null;
  failureNotes: string[];
  successNotes: string[];
  turnCount: number;
  resolvedRecs: number;
}

async function harvestEvidence(sinceDays = 14): Promise<EvidenceBundle> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: metrics } = await admin
    .from("agent_turn_metrics")
    .select(
      "latency_ms, tool_count, tool_error_count, follow_up_required, message_id",
    )
    .eq("agent_kind", "season")
    .gte("created_at", since)
    .limit(500);

  const turns = metrics ?? [];
  const turnCount = turns.length;

  let followUps = 0;
  let toolCalls = 0;
  let toolErrors = 0;
  let latencySum = 0;
  let latencyN = 0;
  for (const t of turns) {
    if (t.follow_up_required) followUps += 1;
    toolCalls += Number(t.tool_count) || 0;
    toolErrors += Number(t.tool_error_count) || 0;
    if (t.latency_ms != null) {
      latencySum += Number(t.latency_ms);
      latencyN += 1;
    }
  }

  const messageIds = turns.map((t) => t.message_id).filter(Boolean);
  let thumbsUpRate: number | null = null;
  if (messageIds.length > 0) {
    const { data: feedback } = await admin
      .from("agent_message_feedback")
      .select("rating")
      .in("message_id", messageIds.slice(0, 200));
    const fb = feedback ?? [];
    if (fb.length > 0) {
      thumbsUpRate = fb.filter((f) => f.rating === "up").length / fb.length;
    }
  }

  const { data: recs } = await admin
    .from("agent_recommendations")
    .select("status, failure_tags, outcome_notes, claim_type")
    .eq("agent_kind", "season")
    .in("status", ["validated", "invalidated"])
    .gte("resolved_at", since)
    .limit(200);

  const resolved = recs ?? [];
  const validated = resolved.filter((r) => r.status === "validated").length;
  const recommendationHitRate =
    resolved.length > 0 ? validated / resolved.length : null;

  const failureNotes = resolved
    .filter((r) => r.status === "invalidated")
    .slice(0, 12)
    .map(
      (r) =>
        `${r.claim_type}: ${r.outcome_notes ?? "invalidated"} tags=${JSON.stringify(r.failure_tags ?? [])}`,
    );

  const successNotes = resolved
    .filter((r) => r.status === "validated")
    .slice(0, 8)
    .map((r) => `${r.claim_type}: ${r.outcome_notes ?? "validated"}`);

  const avgLatency = latencyN > 0 ? latencySum / latencyN : null;
  // 0 at 90s+, 1 at <=15s
  const latencyScore =
    avgLatency == null
      ? null
      : Math.max(0, Math.min(1, 1 - (avgLatency - 15000) / 75000));

  const toolSuccessRate =
    toolCalls > 0 ? Math.max(0, 1 - toolErrors / toolCalls) : null;

  return {
    thumbsUpRate,
    recommendationHitRate,
    followUpRate: turnCount > 0 ? followUps / turnCount : null,
    latencyScore,
    toolSuccessRate,
    failureNotes,
    successNotes,
    turnCount,
    resolvedRecs: resolved.length,
  };
}

type EditOp =
  | { op: "add"; text: string }
  | { op: "delete"; match: string }
  | { op: "replace"; match: string; text: string };

function applyBoundedEdits(content: string, ops: EditOp[]): string {
  let out = content;
  for (const op of ops.slice(0, MAX_EDIT_OPS)) {
    if (op.op === "add") {
      out = `${out.trim()}\n\n${op.text.trim()}`;
    } else if (op.op === "delete" && op.match && out.includes(op.match)) {
      out = out.replace(op.match, "");
    } else if (op.op === "replace" && op.match && out.includes(op.match)) {
      out = out.replace(op.match, op.text);
    }
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** Heuristic optimizer when no API key / to stay within budget. */
function proposeHeuristicEdits(evidence: EvidenceBundle): EditOp[] {
  const ops: EditOp[] = [];

  if ((evidence.followUpRate ?? 0) > 0.15) {
    ops.push({
      op: "add",
      text: "Never end with a clarifying question. If underspecified, state an assumption and give a recommendation.",
    });
  }

  if (evidence.failureNotes.some((n) => /bench_outscored_starter/i.test(n))) {
    ops.push({
      op: "add",
      text: "For start/sit: cross-check injury status and matchup before locking starters; prefer upside when projections are close.",
    });
  }

  if ((evidence.recommendationHitRate ?? 1) < 0.45) {
    ops.push({
      op: "add",
      text: "When tools disagree with narrative advice, trust tool numbers (projections, consistency, matchups) and cite them.",
    });
  }

  if ((evidence.toolSuccessRate ?? 1) < 0.85) {
    ops.push({
      op: "add",
      text: "If a tool errors, retry with simpler args or fall back to another tool; never invent numbers after a tool failure.",
    });
  }

  return ops.slice(0, MAX_EDIT_OPS);
}

async function proposeEditsWithLlm(
  skillContent: string,
  evidence: EvidenceBundle,
): Promise<EditOp[] | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = process.env.AGENT_SLEEP_OPTIMIZER_MODEL?.trim() || "gpt-4.1-mini";
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are SkillOpt-style skill editor. Propose at most 4 bounded add/delete/replace edits to improve a season fantasy football agent skill. Return JSON {\"ops\":[{\"op\":\"add|delete|replace\",\"text\":\"...\",\"match\":\"optional for delete/replace\"}]}. Keep edits short and procedural.",
      },
      {
        role: "user",
        content: JSON.stringify({
          currentSkill: skillContent.slice(0, 6000),
          failures: evidence.failureNotes,
          successes: evidence.successNotes,
          metrics: {
            thumbsUpRate: evidence.thumbsUpRate,
            recommendationHitRate: evidence.recommendationHitRate,
            followUpRate: evidence.followUpRate,
            toolSuccessRate: evidence.toolSuccessRate,
          },
        }),
      },
    ],
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn("[skill-sleep] optimizer HTTP", res.status, await res.text());
    return null;
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as { ops?: EditOp[] };
    if (!Array.isArray(parsed.ops)) return null;
    return parsed.ops
      .filter((o) => o && (o.op === "add" || o.op === "delete" || o.op === "replace"))
      .slice(0, MAX_EDIT_OPS);
  } catch {
    return null;
  }
}

function scoreSkill(content: string, evidence: EvidenceBundle) {
  const fixtures = scoreSkillAgainstFixtures(content);
  return computeSeasonCompositeScore({
    thumbsUpRate: evidence.thumbsUpRate,
    recommendationHitRate: evidence.recommendationHitRate,
    followUpRate: evidence.followUpRate,
    latencyScore: evidence.latencyScore,
    toolSuccessRate: evidence.toolSuccessRate,
    fixtureScore: fixtures.average,
  });
}

/**
 * Weekly SkillOpt-Sleep loop for the season agent skill.
 * Reflect → bounded edit → held-out fixture/metric gate → promote or reject.
 */
export async function runSeasonSkillSleep(opts?: {
  force?: boolean;
  maxUsd?: number;
}): Promise<SkillSleepResult> {
  const maxUsd = opts?.maxUsd ?? Number(process.env.AGENT_SLEEP_MAX_USD || DEFAULT_BUDGET_USD);
  const evidence = await harvestEvidence();

  if (
    !opts?.force &&
    evidence.turnCount < MIN_EVIDENCE_TURNS &&
    evidence.resolvedRecs < MIN_RESOLVED_RECS
  ) {
    return {
      skipped: true,
      reason: `Insufficient evidence (turns=${evidence.turnCount}, resolvedRecs=${evidence.resolvedRecs})`,
    };
  }

  const current = await getActiveSeasonSkill();
  const before = scoreSkill(current.content, evidence);
  const llmOps = await proposeEditsWithLlm(current.content, evidence);
  const ops = llmOps?.length ? llmOps : proposeHeuristicEdits(evidence);

  if (ops.length === 0) {
    return {
      skipped: true,
      reason: "No edits proposed",
      fromVersion: current.version,
      gateBefore: before.score,
      costEstimateUsd: llmOps ? 0.05 : 0,
    };
  }

  const candidate = applyBoundedEdits(current.content, ops);
  const after = scoreSkill(candidate, evidence);
  const admin = createAdminClient();
  const costEstimateUsd = llmOps ? 0.15 : 0.01;

  if (costEstimateUsd > maxUsd) {
    return { skipped: true, reason: "Budget cap", costEstimateUsd };
  }

  const nextVersion = await getNextSeasonSkillVersion();
  const accepted = after.score > before.score + 0.005;

  await admin.from("agent_skills").insert({
    kind: SEASON_SKILL_KIND,
    version: nextVersion,
    content: candidate,
    status: "candidate",
    parent_version: current.version,
    metrics_json: {
      gateBefore: before,
      gateAfter: after,
      ops,
      evidence: {
        turnCount: evidence.turnCount,
        resolvedRecs: evidence.resolvedRecs,
        thumbsUpRate: evidence.thumbsUpRate,
        recommendationHitRate: evidence.recommendationHitRate,
      },
    },
  });

  if (accepted) {
    await admin
      .from("agent_skills")
      .update({ status: "rejected" })
      .eq("kind", SEASON_SKILL_KIND)
      .eq("status", "active");

    await admin
      .from("agent_skills")
      .update({ status: "active" })
      .eq("kind", SEASON_SKILL_KIND)
      .eq("version", nextVersion);

    invalidateSeasonSkillCache();
  } else {
    await admin
      .from("agent_skills")
      .update({ status: "rejected" })
      .eq("kind", SEASON_SKILL_KIND)
      .eq("version", nextVersion);
  }

  await admin.from("agent_skill_edit_log").insert({
    kind: SEASON_SKILL_KIND,
    from_version: current.version,
    to_version: nextVersion,
    proposed_ops: ops,
    gate_score_before: before.score,
    gate_score_after: after.score,
    accepted,
    reject_reason: accepted ? null : "Held-out gate did not improve",
    evidence_summary: {
      turnCount: evidence.turnCount,
      resolvedRecs: evidence.resolvedRecs,
      breakdownBefore: before.breakdown,
      breakdownAfter: after.breakdown,
    },
  });

  await admin.from("agent_skill_eval_runs").insert({
    kind: SEASON_SKILL_KIND,
    skill_version: accepted ? nextVersion : current.version,
    composite_score: accepted ? after.score : before.score,
    metrics_json: accepted ? after.breakdown : before.breakdown,
    fixture_results: scoreSkillAgainstFixtures(
      accepted ? candidate : current.content,
    ).results,
  });

  return {
    accepted,
    fromVersion: current.version,
    toVersion: nextVersion,
    gateBefore: before.score,
    gateAfter: after.score,
    costEstimateUsd,
  };
}
