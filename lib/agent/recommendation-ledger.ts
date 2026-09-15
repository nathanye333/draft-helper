import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SeasonClaimType = "start_sit" | "waiver" | "trade";

export interface LogRecommendationInput {
  leagueId: string;
  userId?: string | null;
  claimType: SeasonClaimType;
  week: number | null;
  season: number | null;
  playerIds: number[];
  payload?: Record<string, unknown>;
  rationaleSummary?: string;
  sourceMessageId?: string | null;
  skillVersion?: number | null;
}

/** Persist a structured recommendation claim for delayed outcome resolution. */
export async function logSeasonRecommendation(
  input: LogRecommendationInput,
  client?: SupabaseClient,
): Promise<string | null> {
  const db = client ?? createAdminClient();
  const { data, error } = await db
    .from("agent_recommendations")
    .insert({
      league_id: input.leagueId,
      user_id: input.userId ?? null,
      agent_kind: "season",
      claim_type: input.claimType,
      week: input.week,
      season: input.season,
      player_ids: input.playerIds,
      payload: input.payload ?? {},
      rationale_summary: input.rationaleSummary ?? null,
      source_message_id: input.sourceMessageId ?? null,
      skill_version: input.skillVersion ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[rec-ledger] insert failed:", error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

/** Extract recommendation claims from completed tool calls. */
export function extractClaimsFromToolCalls(params: {
  leagueId: string;
  userId?: string | null;
  season: number | null;
  week: number | null;
  skillVersion: number | null;
  sourceMessageId: string | null;
  toolCalls: { name: string; output?: string }[];
}): LogRecommendationInput[] {
  const claims: LogRecommendationInput[] = [];

  for (const call of params.toolCalls) {
    if (!call.output) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.output);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const obj = parsed as Record<string, unknown>;
    if (obj.error) continue;

    if (call.name === "suggest_start_sit") {
      const starters = Array.isArray(obj.starters) ? obj.starters : [];
      const bench = Array.isArray(obj.bench) ? obj.bench : [];
      const starterIds = starters
        .map((p) =>
          p && typeof p === "object"
            ? Number((p as { espnPlayerId?: number }).espnPlayerId)
            : NaN,
        )
        .filter((n) => Number.isFinite(n));
      const benchIds = bench
        .map((p) =>
          p && typeof p === "object"
            ? Number((p as { espnPlayerId?: number }).espnPlayerId)
            : NaN,
        )
        .filter((n) => Number.isFinite(n));

      if (starterIds.length > 0) {
        claims.push({
          leagueId: params.leagueId,
          userId: params.userId,
          claimType: "start_sit",
          week: params.week,
          season: params.season,
          playerIds: starterIds,
          payload: { starterEspnIds: starterIds, benchEspnIds: benchIds },
          rationaleSummary: "suggest_start_sit tool recommendation",
          sourceMessageId: params.sourceMessageId,
          skillVersion: params.skillVersion,
        });
      }
    }

    if (call.name === "waiver_targets") {
      const targets = Array.isArray(obj.targets) ? obj.targets : [];
      const ids: number[] = [];
      const fpIds: string[] = [];
      for (const t of targets.slice(0, 5)) {
        if (!t || typeof t !== "object") continue;
        const row = t as {
          espnPlayerId?: number;
          espn_player_id?: number;
          fpPlayerId?: string;
          fp_player_id?: string;
        };
        const espnId = Number(row.espnPlayerId ?? row.espn_player_id);
        if (Number.isFinite(espnId)) ids.push(espnId);
        const fp = row.fpPlayerId ?? row.fp_player_id;
        if (fp) fpIds.push(String(fp));
      }
      if (ids.length > 0 || fpIds.length > 0) {
        claims.push({
          leagueId: params.leagueId,
          userId: params.userId,
          claimType: "waiver",
          week: params.week,
          season: params.season,
          playerIds: ids,
          payload: { topTargets: ids, fpPlayerIds: fpIds },
          rationaleSummary: "waiver_targets top recommendations",
          sourceMessageId: params.sourceMessageId,
          skillVersion: params.skillVersion,
        });
      }
    }

    if (call.name === "evaluate_trade") {
      const give = Array.isArray(obj.give)
        ? obj.give
        : Array.isArray((obj as { youGive?: unknown }).youGive)
          ? ((obj as { youGive: unknown[] }).youGive)
          : [];
      const get = Array.isArray(obj.get)
        ? obj.get
        : Array.isArray((obj as { youGet?: unknown }).youGet)
          ? ((obj as { youGet: unknown[] }).youGet)
          : [];
      const giveIds = give
        .map((p) =>
          p && typeof p === "object"
            ? Number((p as { espnPlayerId?: number }).espnPlayerId)
            : NaN,
        )
        .filter((n) => Number.isFinite(n));
      const getIds = get
        .map((p) =>
          p && typeof p === "object"
            ? Number((p as { espnPlayerId?: number }).espnPlayerId)
            : NaN,
        )
        .filter((n) => Number.isFinite(n));
      const all = [...giveIds, ...getIds];
      if (all.length > 0) {
        claims.push({
          leagueId: params.leagueId,
          userId: params.userId,
          claimType: "trade",
          week: params.week,
          season: params.season,
          playerIds: all,
          payload: {
            giveEspnPlayerIds: giveIds,
            getEspnPlayerIds: getIds,
            verdict: obj.verdict ?? obj.summary ?? null,
          },
          rationaleSummary: "evaluate_trade recommendation",
          sourceMessageId: params.sourceMessageId,
          skillVersion: params.skillVersion,
        });
      }
    }
  }

  return claims;
}

/** Heuristic: did the assistant ask a follow-up / clarifying question? */
export function detectFollowUpRequired(assistantContent: string): boolean {
  const text = assistantContent.trim();
  if (!text) return false;
  const patterns = [
    /\bwould you like\b/i,
    /\bdo you want (me to|to)\b/i,
    /\bshould i\b/i,
    /\bcan you (clarify|confirm|tell me)\b/i,
    /\bwhich (one|player|team)\b.*\?/i,
    /\blet me know\b/i,
  ];
  if (patterns.some((p) => p.test(text))) return true;
  // Question ending the reply often means the agent deferred.
  const lastLine = text.split("\n").filter(Boolean).pop() ?? "";
  return /\?\s*$/.test(lastLine) && lastLine.length < 160;
}
