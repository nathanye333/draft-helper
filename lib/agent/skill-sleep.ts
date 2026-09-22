import { createAdminClient } from "@/lib/supabase/admin";
import {
  computeSeasonCompositeScore,
  scoreSkillAgainstFixtures,
  sessionDepthScore,
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
/** Minimum fixture lift required to promote a candidate skill. */
const FIXTURE_ACCEPT_DELTA = 0.005;

export interface SkillSleepResult {
  skipped?: boolean;
  reason?: string;
  accepted?: boolean;
  fromVersion?: number;
  toVersion?: number;
  gateBefore?: number;
  gateAfter?: number;
  fixtureBefore?: number;
  fixtureAfter?: number;
  costEstimateUsd?: number;
}

interface EvidenceBundle {
  thumbsUpRate: number | null;
  thumbsDownRate: number | null;
  feedbackCount: number;
  feedbackCoverage: number | null;
  continuedTurnRate: number | null;
  avgUserTurnsPerSession: number | null;
  sessionDepthScore: number | null;
  recommendationHitRate: number | null;
  followUpRate: number | null;
  latencyScore: number | null;
  toolSuccessRate: number | null;
  failureNotes: string[];
  chanceNotes: string[];
  infoGapNotes: string[];
  successNotes: string[];
  turnCount: number;
  resolvedRecs: number;
  skillGapCount: number;
  chanceCount: number;
  lackOfInfoCount: number;
}

async function harvestPassiveEngagement(
  admin: ReturnType<typeof createAdminClient>,
  sessionIds: string[],
): Promise<{
  continuedTurnRate: number | null;
  avgUserTurnsPerSession: number | null;
}> {
  if (sessionIds.length === 0) {
    return { continuedTurnRate: null, avgUserTurnsPerSession: null };
  }

  const { data: messages } = await admin
    .from("league_agent_messages")
    .select("session_id, role, sort_order")
    .in("session_id", sessionIds.slice(0, 100))
    .order("sort_order", { ascending: true });

  const bySession = new Map<string, { role: string; sort_order: number }[]>();
  for (const m of messages ?? []) {
    const sid = String(m.session_id);
    const list = bySession.get(sid) ?? [];
    list.push({ role: String(m.role), sort_order: Number(m.sort_order) });
    bySession.set(sid, list);
  }

  let assistantReplies = 0;
  let continued = 0;
  let userTurnSum = 0;
  let sessionN = 0;

  for (const rows of bySession.values()) {
    const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
    const userTurns = sorted.filter((r) => r.role === "user").length;
    if (userTurns > 0) {
      userTurnSum += userTurns;
      sessionN += 1;
    }
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].role !== "assistant") continue;
      assistantReplies += 1;
      if (sorted.slice(i + 1).some((r) => r.role === "user")) continued += 1;
    }
  }

  return {
    continuedTurnRate:
      assistantReplies > 0 ? continued / assistantReplies : null,
    avgUserTurnsPerSession: sessionN > 0 ? userTurnSum / sessionN : null,
  };
}

async function harvestEvidence(sinceDays = 14): Promise<EvidenceBundle> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: metrics } = await admin
    .from("agent_turn_metrics")
    .select(
      "latency_ms, tool_count, tool_error_count, follow_up_required, message_id, session_id",
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
  let thumbsDownRate: number | null = null;
  let feedbackCount = 0;
  if (messageIds.length > 0) {
    const { data: feedback } = await admin
      .from("agent_message_feedback")
      .select("rating")
      .in("message_id", messageIds.slice(0, 200));
    const fb = feedback ?? [];
    feedbackCount = fb.length;
    if (fb.length > 0) {
      const ups = fb.filter((f) => f.rating === "up").length;
      const downs = fb.filter((f) => f.rating === "down").length;
      thumbsUpRate = ups / fb.length;
      thumbsDownRate = downs / fb.length;
    }
  }

  const sessionIds = [
    ...new Set(turns.map((t) => t.session_id).filter(Boolean).map(String)),
  ];
  const passive = await harvestPassiveEngagement(admin, sessionIds);

  const { data: recs } = await admin
    .from("agent_recommendations")
    .select(
      "status, failure_tags, outcome_notes, claim_type, rca_category, rca_notes",
    )
    .eq("agent_kind", "season")
    .in("status", ["validated", "invalidated", "inconclusive"])
    .gte("resolved_at", since)
    .limit(200);

  const resolved = recs ?? [];
  const decided = resolved.filter(
    (r) => r.status === "validated" || r.status === "invalidated",
  );
  const validated = decided.filter((r) => r.status === "validated").length;
  const recommendationHitRate =
    decided.length > 0 ? validated / decided.length : null;

  // Only skill_gap failures should drive skill edits; chance / missing info do not.
  const skillGapRows = resolved.filter(
    (r) =>
      r.status === "invalidated" &&
      (r.rca_category === "skill_gap" ||
        (!r.rca_category &&
          Array.isArray(r.failure_tags) &&
          (r.failure_tags as string[]).includes("bench_outscored_starter"))),
  );
  const chanceRows = resolved.filter((r) => r.rca_category === "chance");
  const infoGapRows = resolved.filter(
    (r) => r.rca_category === "lack_of_information",
  );

  const failureNotes = skillGapRows
    .slice(0, 12)
    .map(
      (r) =>
        `${r.claim_type} [skill_gap]: ${r.rca_notes ?? r.outcome_notes ?? "invalidated"} tags=${JSON.stringify(r.failure_tags ?? [])}`,
    );

  const chanceNotes = chanceRows
    .slice(0, 6)
    .map(
      (r) =>
        `${r.claim_type} [chance]: ${r.rca_notes ?? r.outcome_notes ?? "variance"}`,
    );

  const infoGapNotes = infoGapRows
    .slice(0, 6)
    .map(
      (r) =>
        `${r.claim_type} [lack_of_information]: ${r.rca_notes ?? r.outcome_notes ?? "missing data"}`,
    );

  const successNotes = decided
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
    thumbsDownRate,
    feedbackCount,
    feedbackCoverage: turnCount > 0 ? feedbackCount / turnCount : null,
    continuedTurnRate: passive.continuedTurnRate,
    avgUserTurnsPerSession: passive.avgUserTurnsPerSession,
    sessionDepthScore: sessionDepthScore(passive.avgUserTurnsPerSession),
    recommendationHitRate,
    followUpRate: turnCount > 0 ? followUps / turnCount : null,
    latencyScore,
    toolSuccessRate,
    failureNotes,
    chanceNotes,
    infoGapNotes,
    successNotes,
    turnCount,
    resolvedRecs: decided.length,
    skillGapCount: skillGapRows.length,
    chanceCount: chanceRows.length,
    lackOfInfoCount: infoGapRows.length,
  };
}

type EditOp =
  | { op: "add"; text: string; match?: string }
  | { op: "delete"; match: string }
  | { op: "replace"; match: string; text: string };

function applyBoundedEdits(content: string, ops: EditOp[]): string {
  let out = content;
  for (const op of ops.slice(0, MAX_EDIT_OPS)) {
    if (op.op === "add") {
      const addition = op.text.trim();
      if (!addition) continue;
      if (op.match && out.includes(op.match)) {
        out = out.replace(op.match, `${op.match}\n\n${addition}`);
      } else {
        out = `${out.trim()}\n\n${addition}`;
      }
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
          skillGapFailures: evidence.failureNotes,
          chanceFailures: evidence.chanceNotes,
          lackOfInformation: evidence.infoGapNotes,
          successes: evidence.successNotes,
          guidance:
            "Only propose skill edits for skillGapFailures. Do not change the skill for chanceFailures (variance) or lackOfInformation (missing data).",
          metrics: {
            thumbsUpRate: evidence.thumbsUpRate,
            thumbsDownRate: evidence.thumbsDownRate,
            feedbackCount: evidence.feedbackCount,
            feedbackCoverage: evidence.feedbackCoverage,
            continuedTurnRate: evidence.continuedTurnRate,
            sessionDepthScore: evidence.sessionDepthScore,
            recommendationHitRate: evidence.recommendationHitRate,
            followUpRate: evidence.followUpRate,
            toolSuccessRate: evidence.toolSuccessRate,
            skillGapCount: evidence.skillGapCount,
            chanceCount: evidence.chanceCount,
            lackOfInfoCount: evidence.lackOfInfoCount,
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
  const composite = computeSeasonCompositeScore({
    thumbsUpRate: evidence.thumbsUpRate,
    feedbackCount: evidence.feedbackCount,
    turnCount: evidence.turnCount,
    thumbsDownRate: evidence.thumbsDownRate,
    recommendationHitRate: evidence.recommendationHitRate,
    followUpRate: evidence.followUpRate,
    latencyScore: evidence.latencyScore,
    toolSuccessRate: evidence.toolSuccessRate,
    continuedTurnRate: evidence.continuedTurnRate,
    sessionDepthScore: evidence.sessionDepthScore,
    fixtureScore: fixtures.average,
  });
  return { ...composite, fixtureScore: fixtures.average };
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
  // Live engagement metrics are identical before/after a text-only edit.
  // Promote only when held-out fixture coverage improves.
  const accepted =
    after.fixtureScore > before.fixtureScore + FIXTURE_ACCEPT_DELTA;

  await admin.from("agent_skills").insert({
    kind: SEASON_SKILL_KIND,
    version: nextVersion,
    content: candidate,
    status: "candidate",
    parent_version: current.version,
    metrics_json: {
      gateBefore: before,
      gateAfter: after,
      fixtureBefore: before.fixtureScore,
      fixtureAfter: after.fixtureScore,
      ops,
      evidence: {
        turnCount: evidence.turnCount,
        resolvedRecs: evidence.resolvedRecs,
        thumbsUpRate: evidence.thumbsUpRate,
        thumbsDownRate: evidence.thumbsDownRate,
        feedbackCount: evidence.feedbackCount,
        feedbackCoverage: evidence.feedbackCoverage,
        continuedTurnRate: evidence.continuedTurnRate,
        sessionDepthScore: evidence.sessionDepthScore,
        recommendationHitRate: evidence.recommendationHitRate,
        skillGapCount: evidence.skillGapCount,
        chanceCount: evidence.chanceCount,
        lackOfInfoCount: evidence.lackOfInfoCount,
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
    gate_score_before: before.fixtureScore,
    gate_score_after: after.fixtureScore,
    accepted,
    reject_reason: accepted
      ? null
      : "Held-out fixture coverage did not improve",
    evidence_summary: {
      turnCount: evidence.turnCount,
      resolvedRecs: evidence.resolvedRecs,
      thumbsUpRate: evidence.thumbsUpRate,
      thumbsDownRate: evidence.thumbsDownRate,
      feedbackCount: evidence.feedbackCount,
      continuedTurnRate: evidence.continuedTurnRate,
      sessionDepthScore: evidence.sessionDepthScore,
      skillGapCount: evidence.skillGapCount,
      chanceCount: evidence.chanceCount,
      lackOfInfoCount: evidence.lackOfInfoCount,
      healthBefore: before.score,
      healthAfter: after.score,
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
    gateBefore: before.fixtureScore,
    gateAfter: after.fixtureScore,
    fixtureBefore: before.fixtureScore,
    fixtureAfter: after.fixtureScore,
    costEstimateUsd,
  };
}
