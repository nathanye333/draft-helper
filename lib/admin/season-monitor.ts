import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonSkill } from "@/lib/agent/season-skill";
import {
  computeSeasonCompositeScore,
  scoreSkillAgainstFixtures,
} from "@/lib/agent/season-eval";

const WINDOW_DAYS = 14;

export interface SeasonMonitorSnapshot {
  windowDays: number;
  skill: { version: number; status: string; content: string };
  turns: number;
  thumbsUpRate: number | null;
  followUpRate: number | null;
  avgLatencyMs: number | null;
  toolSuccessRate: number | null;
  recommendations: {
    validated: number;
    invalidated: number;
    pending: number;
    hitRate: number | null;
  };
  fixtureScore: number;
  composite: number;
  breakdown: Record<string, number>;
  recentEdits: {
    from_version: number | null;
    to_version: number | null;
    accepted: boolean;
    gate_score_before: number | null;
    gate_score_after: number | null;
    proposed_ops: unknown;
    reject_reason: string | null;
    created_at: string;
  }[];
  recentRecommendations: {
    id: string;
    claim_type: string;
    status: string;
    week: number | null;
    outcome_notes: string | null;
    failure_tags: unknown;
    created_at: string;
    resolved_at: string | null;
  }[];
}

/** Global (all users) season-agent self-improvement snapshot for admin UI. */
export async function loadSeasonMonitorSnapshot(): Promise<SeasonMonitorSnapshot> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: metrics } = await admin
    .from("agent_turn_metrics")
    .select("latency_ms, tool_count, tool_error_count, follow_up_required, message_id")
    .eq("agent_kind", "season")
    .gte("created_at", since)
    .limit(1000);

  const turns = metrics ?? [];
  const followUpRate =
    turns.length > 0
      ? turns.filter((t) => t.follow_up_required).length / turns.length
      : null;
  const toolCalls = turns.reduce((s, t) => s + (Number(t.tool_count) || 0), 0);
  const toolErrors = turns.reduce((s, t) => s + (Number(t.tool_error_count) || 0), 0);
  const latencies = turns
    .map((t) => t.latency_ms)
    .filter((n): n is number => n != null)
    .map(Number);
  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null;

  const messageIds = turns.map((t) => t.message_id).filter(Boolean);
  let thumbsUpRate: number | null = null;
  if (messageIds.length > 0) {
    const { data: fb } = await admin
      .from("agent_message_feedback")
      .select("rating")
      .in("message_id", messageIds.slice(0, 500));
    if (fb && fb.length > 0) {
      thumbsUpRate = fb.filter((f) => f.rating === "up").length / fb.length;
    }
  }

  const { data: recs } = await admin
    .from("agent_recommendations")
    .select("status")
    .eq("agent_kind", "season")
    .gte("created_at", since)
    .limit(500);

  let validated = 0;
  let invalidated = 0;
  let pending = 0;
  for (const r of recs ?? []) {
    if (r.status === "validated") validated += 1;
    else if (r.status === "invalidated") invalidated += 1;
    else pending += 1;
  }
  const decided = validated + invalidated;
  const hitRate = decided > 0 ? validated / decided : null;

  const skill = await getActiveSeasonSkill();
  const fixtures = scoreSkillAgainstFixtures(skill.content);
  const latencyScore =
    avgLatencyMs == null
      ? null
      : Math.max(0, Math.min(1, 1 - (avgLatencyMs - 15000) / 75000));
  const toolSuccessRate = toolCalls > 0 ? Math.max(0, 1 - toolErrors / toolCalls) : null;
  const composite = computeSeasonCompositeScore({
    thumbsUpRate,
    recommendationHitRate: hitRate,
    followUpRate,
    latencyScore,
    toolSuccessRate,
    fixtureScore: fixtures.average,
  });

  const { data: recentEdits } = await admin
    .from("agent_skill_edit_log")
    .select(
      "from_version, to_version, accepted, gate_score_before, gate_score_after, proposed_ops, reject_reason, created_at",
    )
    .eq("kind", "season")
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: recentRecommendations } = await admin
    .from("agent_recommendations")
    .select(
      "id, claim_type, status, week, outcome_notes, failure_tags, created_at, resolved_at",
    )
    .eq("agent_kind", "season")
    .order("created_at", { ascending: false })
    .limit(20);

  return {
    windowDays: WINDOW_DAYS,
    skill: {
      version: skill.version,
      status: skill.status,
      content: skill.content,
    },
    turns: turns.length,
    thumbsUpRate,
    followUpRate,
    avgLatencyMs,
    toolSuccessRate,
    recommendations: { validated, invalidated, pending, hitRate },
    fixtureScore: fixtures.average,
    composite: composite.score,
    breakdown: composite.breakdown,
    recentEdits: (recentEdits ?? []).map((e) => ({
      from_version: e.from_version != null ? Number(e.from_version) : null,
      to_version: e.to_version != null ? Number(e.to_version) : null,
      accepted: Boolean(e.accepted),
      gate_score_before:
        e.gate_score_before != null ? Number(e.gate_score_before) : null,
      gate_score_after:
        e.gate_score_after != null ? Number(e.gate_score_after) : null,
      proposed_ops: e.proposed_ops,
      reject_reason: e.reject_reason != null ? String(e.reject_reason) : null,
      created_at: String(e.created_at),
    })),
    recentRecommendations: (recentRecommendations ?? []).map((r) => ({
      id: String(r.id),
      claim_type: String(r.claim_type),
      status: String(r.status),
      week: r.week != null ? Number(r.week) : null,
      outcome_notes: r.outcome_notes != null ? String(r.outcome_notes) : null,
      failure_tags: r.failure_tags,
      created_at: String(r.created_at),
      resolved_at: r.resolved_at != null ? String(r.resolved_at) : null,
    })),
  };
}
