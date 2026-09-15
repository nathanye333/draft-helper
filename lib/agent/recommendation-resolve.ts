import { createAdminClient } from "@/lib/supabase/admin";
import { applyStartSitOutcome } from "@/lib/agent/recommendation-resolve-logic";

const BENCH_BEAT_STARTER_THRESHOLD = 3;
const AWAITING_SYNC_EXPIRE_DAYS = 14;

export interface ResolveRecommendationsResult {
  leagueId: string;
  resolved: number;
  awaitingOutcome: number;
  awaitingSync: number;
  inconclusive: number;
}

/**
 * Resolve pending season-agent recommendation claims after a full ESPN sync.
 * Safe to call from cron or manual sync; no-ops when no claims exist.
 */
export async function resolvePendingRecommendations(
  leagueId: string,
  opts?: { syncedAt?: string; syncKind?: "full" | "light" },
): Promise<ResolveRecommendationsResult> {
  const admin = createAdminClient();
  const syncedAt = opts?.syncedAt ?? new Date().toISOString();
  const syncKind = opts?.syncKind ?? "full";

  const result: ResolveRecommendationsResult = {
    leagueId,
    resolved: 0,
    awaitingOutcome: 0,
    awaitingSync: 0,
    inconclusive: 0,
  };

  const { data: league } = await admin
    .from("leagues")
    .select("id, season, current_week")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) return result;

  const { data: claims, error } = await admin
    .from("agent_recommendations")
    .select("*")
    .eq("league_id", leagueId)
    .in("status", ["pending", "awaiting_outcome", "awaiting_sync"]);

  if (error || !claims?.length) return result;

  const season = Number(league.season);
  const currentWeek =
    league.current_week != null && Number(league.current_week) > 0
      ? Number(league.current_week)
      : null;

  for (const claim of claims) {
    const claimWeek = claim.week != null ? Number(claim.week) : null;
    const claimType = String(claim.claim_type);
    const playerIds = Array.isArray(claim.player_ids)
      ? (claim.player_ids as number[])
      : [];

    if (claim.status === "awaiting_sync" && claim.created_at) {
      const ageMs = Date.now() - new Date(String(claim.created_at)).getTime();
      if (ageMs > AWAITING_SYNC_EXPIRE_DAYS * 24 * 60 * 60 * 1000) {
        await admin
          .from("agent_recommendations")
          .update({
            status: "inconclusive",
            outcome_notes: "Expired waiting for sync data",
            resolved_at: syncedAt,
            truth_source: syncKind === "full" ? "espn_full" : "espn_light",
            data_as_of: syncedAt,
          })
          .eq("id", claim.id);
        result.inconclusive += 1;
        continue;
      }
    }

    if (claimType === "start_sit") {
      if (claimWeek == null) {
        await markInconclusive(admin, claim.id, syncedAt, syncKind, "Missing claim week");
        result.inconclusive += 1;
        continue;
      }

      if (currentWeek == null || currentWeek <= claimWeek) {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_outcome", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingOutcome += 1;
        continue;
      }

      if (syncKind !== "full") {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_sync", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingSync += 1;
        continue;
      }

      const payload = (claim.payload ?? {}) as {
        starterEspnIds?: number[];
        benchEspnIds?: number[];
      };
      const starterIds = payload.starterEspnIds?.length
        ? payload.starterEspnIds
        : playerIds;
      const benchIds = payload.benchEspnIds ?? [];

      if (starterIds.length === 0) {
        await markInconclusive(admin, claim.id, syncedAt, syncKind, "No starter ids");
        result.inconclusive += 1;
        continue;
      }

      const allIds = [...new Set([...starterIds, ...benchIds])];
      const { data: points } = await admin
        .from("espn_player_week_points")
        .select("espn_player_id, actual_points")
        .eq("league_id", leagueId)
        .eq("season", season)
        .eq("week", claimWeek)
        .in("espn_player_id", allIds);

      const actualById = new Map<number, number | null>();
      for (const row of points ?? []) {
        actualById.set(
          Number(row.espn_player_id),
          row.actual_points != null ? Number(row.actual_points) : null,
        );
      }

      const outcome = applyStartSitOutcome({
        starterIds,
        benchIds,
        actualById,
        threshold: BENCH_BEAT_STARTER_THRESHOLD,
      });

      if (outcome.status === "awaiting_sync") {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_sync", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingSync += 1;
        continue;
      }

      await admin
        .from("agent_recommendations")
        .update({
          status: outcome.status,
          outcome_score: outcome.outcomeScore,
          outcome_notes: outcome.outcomeNotes,
          failure_tags: outcome.failureTags,
          resolved_at: syncedAt,
          truth_source: "espn_full",
          data_as_of: syncedAt,
        })
        .eq("id", claim.id);
      result.resolved += 1;
      continue;
    }

    if (claimType === "waiver") {
      if (claimWeek == null || currentWeek == null || currentWeek < claimWeek + 1) {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_outcome", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingOutcome += 1;
        continue;
      }

      const payload = (claim.payload ?? {}) as { fpPlayerIds?: string[] };
      const fpIds = Array.isArray(payload.fpPlayerIds) ? payload.fpPlayerIds : [];

      if (playerIds.length === 0 && fpIds.length === 0) {
        await markInconclusive(admin, claim.id, syncedAt, syncKind, "No player ids");
        result.inconclusive += 1;
        continue;
      }

      let acquiredCount = 0;
      if (playerIds.length > 0) {
        const { data: roster } = await admin
          .from("league_roster_entries")
          .select("espn_player_id")
          .eq("league_id", leagueId)
          .in("espn_player_id", playerIds);
        const onRoster = new Set((roster ?? []).map((r) => Number(r.espn_player_id)));
        acquiredCount += playerIds.filter((id) => onRoster.has(id)).length;
      }
      if (fpIds.length > 0) {
        const { data: rosterFp } = await admin
          .from("league_roster_entries")
          .select("fp_player_id")
          .eq("league_id", leagueId)
          .in("fp_player_id", fpIds);
        const onRosterFp = new Set(
          (rosterFp ?? []).map((r) => String(r.fp_player_id)).filter(Boolean),
        );
        acquiredCount += fpIds.filter((id) => onRosterFp.has(id)).length;
      }

      const targetCount = Math.max(playerIds.length, fpIds.length);

      if (acquiredCount > 0) {
        await admin
          .from("agent_recommendations")
          .update({
            status: "validated",
            outcome_notes: `Acquired ${acquiredCount}/${targetCount} recommended targets`,
            outcome_score: acquiredCount / targetCount,
            resolved_at: syncedAt,
            truth_source: syncKind === "full" ? "espn_full" : "espn_light",
            data_as_of: syncedAt,
            failure_tags: [],
          })
          .eq("id", claim.id);
        result.resolved += 1;
      } else if (currentWeek >= claimWeek + 3) {
        await admin
          .from("agent_recommendations")
          .update({
            status: "inconclusive",
            outcome_notes: "Recommended targets never acquired within 3 weeks",
            resolved_at: syncedAt,
            truth_source: syncKind === "full" ? "espn_full" : "espn_light",
            data_as_of: syncedAt,
            failure_tags: ["never_acquired"],
          })
          .eq("id", claim.id);
        result.inconclusive += 1;
      } else {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_outcome", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingOutcome += 1;
      }
      continue;
    }

    if (claimType === "trade") {
      if (claimWeek == null || currentWeek == null || currentWeek < claimWeek + 2) {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_outcome", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingOutcome += 1;
        continue;
      }

      await admin
        .from("agent_recommendations")
        .update({
          status: "inconclusive",
          outcome_notes:
            "Trade outcomes are noisy; logged for review without auto validate/invalidate",
          resolved_at: syncedAt,
          truth_source: syncKind === "full" ? "espn_full" : "espn_light",
          data_as_of: syncedAt,
        })
        .eq("id", claim.id);
      result.inconclusive += 1;
      continue;
    }

    await markInconclusive(admin, claim.id, syncedAt, syncKind, `Unknown claim type ${claimType}`);
    result.inconclusive += 1;
  }

  return result;
}

async function markInconclusive(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  syncedAt: string,
  syncKind: "full" | "light",
  notes: string,
) {
  await admin
    .from("agent_recommendations")
    .update({
      status: "inconclusive",
      outcome_notes: notes,
      resolved_at: syncedAt,
      truth_source: syncKind === "full" ? "espn_full" : "espn_light",
      data_as_of: syncedAt,
    })
    .eq("id", id);
}
