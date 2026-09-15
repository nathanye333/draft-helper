import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSeasonSkill } from "@/lib/agent/season-skill";
import {
  scoreSkillAgainstFixtures,
  computeSeasonCompositeScore,
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
    .select("latency_ms, tool_count, tool_error_count, follow_up_required, message_id")
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

  const messageIds = turns.map((t) => t.message_id);
  let thumbsUpRate: number | null = null;
  if (messageIds.length > 0) {
    const { data: fb } = await supabase
      .from("agent_message_feedback")
      .select("rating")
      .eq("user_id", user.id)
      .in("message_id", messageIds.slice(0, 200));
    if (fb && fb.length > 0) {
      thumbsUpRate = fb.filter((f) => f.rating === "up").length / fb.length;
    }
  }

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

  const skill = await getActiveSeasonSkill();
  const fixtures = scoreSkillAgainstFixtures(skill.content);
  const latencyScore =
    avgLatency == null
      ? null
      : Math.max(0, Math.min(1, 1 - (avgLatency - 15000) / 75000));
  const composite = computeSeasonCompositeScore({
    thumbsUpRate,
    recommendationHitRate,
    followUpRate,
    latencyScore,
    toolSuccessRate: toolCalls > 0 ? 1 - toolErrors / toolCalls : null,
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
    followUpRate,
    avgLatencyMs: avgLatency,
    toolSuccessRate: toolCalls > 0 ? 1 - toolErrors / toolCalls : null,
    recommendations: recCounts,
    recommendationHitRate,
    fixtureScore: fixtures.average,
    composite: composite.score,
    breakdown: composite.breakdown,
    recentEdits: recentEdits ?? [],
  });
}
