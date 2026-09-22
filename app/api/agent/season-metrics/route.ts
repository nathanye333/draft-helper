import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonSkill } from "@/lib/agent/season-skill";
import {
  scoreSkillAgainstFixtures,
  computeSeasonCompositeScore,
  sessionDepthScore,
} from "@/lib/agent/season-eval";

/**
 * Lightweight season-agent self-improvement metrics for the authenticated user.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: metrics } = await supabase
    .from("agent_turn_metrics")
    .select(
      "latency_ms, tool_count, tool_error_count, follow_up_required, message_id, session_id",
    )
    .eq("user_id", user.id)
    .eq("agent_kind", "season")
    .gte("created_at", since);

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
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : null;

  const messageIds = turns.map((t) => t.message_id).filter(Boolean);
  let thumbsUpRate: number | null = null;
  let thumbsDownRate: number | null = null;
  let feedbackCount = 0;
  if (messageIds.length > 0) {
    const { data: fb } = await supabase
      .from("agent_message_feedback")
      .select("rating")
      .eq("user_id", user.id)
      .in("message_id", messageIds.slice(0, 200));
    feedbackCount = fb?.length ?? 0;
    if (fb && fb.length > 0) {
      const ups = fb.filter((f) => f.rating === "up").length;
      const downs = fb.filter((f) => f.rating === "down").length;
      thumbsUpRate = ups / fb.length;
      thumbsDownRate = downs / fb.length;
    }
  }

  const sessionIds = [
    ...new Set(turns.map((t) => t.session_id).filter(Boolean).map(String)),
  ];
  let continuedTurnRate: number | null = null;
  let avgUserTurnsPerSession: number | null = null;
  if (sessionIds.length > 0) {
    const { data: messages } = await supabase
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
    continuedTurnRate =
      assistantReplies > 0 ? continued / assistantReplies : null;
    avgUserTurnsPerSession = sessionN > 0 ? userTurnSum / sessionN : null;
  }

  const depthScore = sessionDepthScore(avgUserTurnsPerSession);

  const { data: leagues } = await supabase.from("leagues").select("id").eq("user_id", user.id);
  const leagueIds = (leagues ?? []).map((l) => l.id);
  let recommendationHitRate: number | null = null;
  let recCounts = { validated: 0, invalidated: 0, pending: 0 };
  if (leagueIds.length > 0) {
    const { data: recs } = await supabase
      .from("agent_recommendations")
      .select("status")
      .in("league_id", leagueIds)
      .gte("created_at", since);
    for (const r of recs ?? []) {
      if (r.status === "validated") recCounts.validated += 1;
      else if (r.status === "invalidated") recCounts.invalidated += 1;
      else recCounts.pending += 1;
    }
    const decided = recCounts.validated + recCounts.invalidated;
    if (decided > 0) recommendationHitRate = recCounts.validated / decided;
  }

  let rcaCounts = { skill_gap: 0, chance: 0, lack_of_information: 0 };
  if (leagueIds.length > 0) {
    const { data: rcaRows } = await supabase
      .from("agent_recommendations")
      .select("rca_category")
      .in("league_id", leagueIds)
      .not("rca_category", "is", null)
      .gte("resolved_at", since);
    for (const r of rcaRows ?? []) {
      const cat = String(r.rca_category);
      if (cat === "skill_gap") rcaCounts.skill_gap += 1;
      else if (cat === "chance") rcaCounts.chance += 1;
      else if (cat === "lack_of_information") rcaCounts.lack_of_information += 1;
    }
  }

  const skill = await getActiveSeasonSkill();
  const fixtures = scoreSkillAgainstFixtures(skill.content);
  const latencyScore =
    avgLatency == null
      ? null
      : Math.max(0, Math.min(1, 1 - (avgLatency - 15000) / 75000));
  const composite = computeSeasonCompositeScore({
    thumbsUpRate,
    feedbackCount,
    turnCount: turns.length,
    thumbsDownRate,
    recommendationHitRate,
    followUpRate,
    latencyScore,
    toolSuccessRate: toolCalls > 0 ? 1 - toolErrors / toolCalls : null,
    continuedTurnRate,
    sessionDepthScore: depthScore,
    fixtureScore: fixtures.average,
  });

  const admin = createAdminClient();
  const { data: recentEdits } = await admin
    .from("agent_skill_edit_log")
    .select("from_version, to_version, accepted, gate_score_before, gate_score_after, created_at")
    .eq("kind", "season")
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    ok: true,
    skill: { version: skill.version, status: skill.status },
    windowDays: 14,
    turns: turns.length,
    thumbsUpRate,
    thumbsDownRate,
    feedbackCount,
    feedbackCoverage: turns.length > 0 ? feedbackCount / turns.length : null,
    continuedTurnRate,
    avgUserTurnsPerSession,
    sessionDepthScore: depthScore,
    followUpRate,
    avgLatencyMs: avgLatency,
    toolSuccessRate: toolCalls > 0 ? 1 - toolErrors / toolCalls : null,
    recommendations: recCounts,
    recommendationHitRate,
    rca: rcaCounts,
    fixtureScore: fixtures.average,
    composite: composite.score,
    breakdown: composite.breakdown,
    recentEdits: recentEdits ?? [],
  });
}
