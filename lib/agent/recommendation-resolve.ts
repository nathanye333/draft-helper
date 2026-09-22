import { createAdminClient } from "@/lib/supabase/admin";
import { applyStartSitOutcome } from "@/lib/agent/recommendation-resolve-logic";
import {
  classifyStartSitRca,
  classifyWaiverRca,
} from "@/lib/agent/recommendation-rca";

const BENCH_BEAT_STARTER_THRESHOLD = 3;
const AWAITING_SYNC_EXPIRE_DAYS = 14;

export interface ResolveRecommendationsResult {
  leagueId: string;
  resolved: number;
  awaitingOutcome: number;
  awaitingSync: number;
  inconclusive: number;
  rcaSkillGap: number;
  rcaChance: number;
  rcaLackOfInfo: number;
}

/**
 * Resolve pending season-agent recommendation claims after a full ESPN sync
 * or the end-of-week verification cron.
 * Safe to call repeatedly; no-ops when no claims exist.
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
    rcaSkillGap: 0,
    rcaChance: 0,
    rcaLackOfInfo: 0,
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
            rca_category: "lack_of_information",
            rca_notes: "Timed out waiting for ESPN week points sync",
            rca_json: { reason: "awaiting_sync_expired" },
            resolved_at: syncedAt,
            truth_source: syncKind === "full" ? "espn_full" : "espn_light",
            data_as_of: syncedAt,
          })
          .eq("id", claim.id);
        result.inconclusive += 1;
        result.rcaLackOfInfo += 1;
        continue;
      }
    }

    if (claimType === "start_sit") {
      if (claimWeek == null) {
        await markInconclusive(
          admin,
          claim.id,
          syncedAt,
          syncKind,
          "Missing claim week",
          "lack_of_information",
        );
        result.inconclusive += 1;
        result.rcaLackOfInfo += 1;
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
        await markInconclusive(
          admin,
          claim.id,
          syncedAt,
          syncKind,
          "No starter ids",
          "lack_of_information",
        );
        result.inconclusive += 1;
        result.rcaLackOfInfo += 1;
        continue;
      }

      const allIds = [...new Set([...starterIds, ...benchIds])];
      const { data: points } = await admin
        .from("espn_player_week_points")
        .select("espn_player_id, actual_points, projected_points")
        .eq("league_id", leagueId)
        .eq("season", season)
        .eq("week", claimWeek)
        .in("espn_player_id", allIds);

      const actualById = new Map<number, number | null>();
      const projectedById = new Map<number, number | null>();
      for (const row of points ?? []) {
        const id = Number(row.espn_player_id);
        actualById.set(
          id,
          row.actual_points != null ? Number(row.actual_points) : null,
        );
        projectedById.set(
          id,
          row.projected_points != null ? Number(row.projected_points) : null,
        );
      }

      const hasEnoughActuals =
        starterIds.filter((id) => actualById.get(id) != null).length >=
          Math.ceil(starterIds.length * 0.5) ||
        allIds.some((id) => actualById.get(id) != null);

      // Prefer week rollover; also resolve once actuals landed even if ESPN
      // current_week has not advanced yet (end-of-week Tuesday sweep).
      const weekComplete =
        (currentWeek != null && currentWeek > claimWeek) ||
        (hasEnoughActuals &&
          allIds.filter((id) => actualById.get(id) != null).length >=
            Math.max(1, Math.ceil(allIds.length * 0.6)));

      if (!weekComplete) {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_outcome", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingOutcome += 1;
        continue;
      }

      if (syncKind !== "full" && !hasEnoughActuals) {
        await admin
          .from("agent_recommendations")
          .update({ status: "awaiting_sync", data_as_of: syncedAt })
          .eq("id", claim.id);
        result.awaitingSync += 1;
        continue;
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

      const injuryById = await loadInjuryStatuses(admin, leagueId, [
        outcome.lowestStarterId,
        outcome.bestBenchId,
      ]);

      const rca = classifyStartSitRca({
        status: outcome.status,
        lowestStarterActual: outcome.lowestStarterActual ?? 0,
        bestBenchActual: outcome.bestBenchActual ?? 0,
        lowestStarterProjected:
          outcome.lowestStarterId != null
            ? (projectedById.get(outcome.lowestStarterId) ?? null)
            : null,
        bestBenchProjected:
          outcome.bestBenchId != null
            ? (projectedById.get(outcome.bestBenchId) ?? null)
            : null,
        lowestStarterInjury:
          outcome.lowestStarterId != null
            ? (injuryById.get(outcome.lowestStarterId) ?? null)
            : null,
        bestBenchInjury:
          outcome.bestBenchId != null
            ? (injuryById.get(outcome.bestBenchId) ?? null)
            : null,
        actualGap: outcome.actualGap ?? 0,
        invalidateThreshold: BENCH_BEAT_STARTER_THRESHOLD,
      });

      tallyRca(result, rca.category);

      await admin
        .from("agent_recommendations")
        .update({
          status: outcome.status,
          outcome_score: outcome.outcomeScore,
          outcome_notes: outcome.outcomeNotes,
          failure_tags: [...outcome.failureTags, ...rca.tags],
          rca_category: rca.category,
          rca_notes: rca.notes,
          rca_json: rca.evidence,
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
        await markInconclusive(
          admin,
          claim.id,
          syncedAt,
          syncKind,
          "No player ids",
          "lack_of_information",
        );
        result.inconclusive += 1;
        result.rcaLackOfInfo += 1;
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
        const rca = classifyWaiverRca({
          status: "validated",
          acquiredCount,
          targetCount,
        });
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
            rca_category: rca.category,
            rca_notes: rca.notes,
            rca_json: rca.evidence,
          })
          .eq("id", claim.id);
        result.resolved += 1;
      } else if (currentWeek >= claimWeek + 3) {
        const rca = classifyWaiverRca({
          status: "inconclusive",
          acquiredCount: 0,
          targetCount,
        });
        tallyRca(result, rca.category);
        await admin
          .from("agent_recommendations")
          .update({
            status: "inconclusive",
            outcome_notes: "Recommended targets never acquired within 3 weeks",
            resolved_at: syncedAt,
            truth_source: syncKind === "full" ? "espn_full" : "espn_light",
            data_as_of: syncedAt,
            failure_tags: ["never_acquired", ...rca.tags],
            rca_category: rca.category,
            rca_notes: rca.notes,
            rca_json: rca.evidence,
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
          rca_category: "lack_of_information",
          rca_notes:
            "Trade value needs longer horizon and counterfactual roster paths; not auto-scored.",
          rca_json: { reason: "trade_noisy" },
          resolved_at: syncedAt,
          truth_source: syncKind === "full" ? "espn_full" : "espn_light",
          data_as_of: syncedAt,
        })
        .eq("id", claim.id);
      result.inconclusive += 1;
      result.rcaLackOfInfo += 1;
      continue;
    }

    await markInconclusive(
      admin,
      claim.id,
      syncedAt,
      syncKind,
      `Unknown claim type ${claimType}`,
      "lack_of_information",
    );
    result.inconclusive += 1;
    result.rcaLackOfInfo += 1;
  }

  return result;
}

/**
 * Sweep all leagues that have unresolved recommendation claims.
 * Intended for the end-of-week cron after games finish.
 */
export async function resolveAllPendingRecommendations(opts?: {
  syncKind?: "full" | "light";
}): Promise<{
  leagues: number;
  totals: Omit<ResolveRecommendationsResult, "leagueId">;
  results: ResolveRecommendationsResult[];
}> {
  const admin = createAdminClient();
  const syncKind = opts?.syncKind ?? "full";
  const syncedAt = new Date().toISOString();

  const { data: rows } = await admin
    .from("agent_recommendations")
    .select("league_id")
    .in("status", ["pending", "awaiting_outcome", "awaiting_sync"]);

  const leagueIds = [
    ...new Set((rows ?? []).map((r) => String(r.league_id)).filter(Boolean)),
  ];

  const results: ResolveRecommendationsResult[] = [];
  const totals = {
    resolved: 0,
    awaitingOutcome: 0,
    awaitingSync: 0,
    inconclusive: 0,
    rcaSkillGap: 0,
    rcaChance: 0,
    rcaLackOfInfo: 0,
  };

  for (const leagueId of leagueIds) {
    const r = await resolvePendingRecommendations(leagueId, {
      syncedAt,
      syncKind,
    });
    results.push(r);
    totals.resolved += r.resolved;
    totals.awaitingOutcome += r.awaitingOutcome;
    totals.awaitingSync += r.awaitingSync;
    totals.inconclusive += r.inconclusive;
    totals.rcaSkillGap += r.rcaSkillGap;
    totals.rcaChance += r.rcaChance;
    totals.rcaLackOfInfo += r.rcaLackOfInfo;
  }

  return { leagues: leagueIds.length, totals, results };
}

function tallyRca(
  result: ResolveRecommendationsResult,
  category: string | null,
) {
  if (category === "skill_gap") result.rcaSkillGap += 1;
  else if (category === "chance") result.rcaChance += 1;
  else if (category === "lack_of_information") result.rcaLackOfInfo += 1;
}

async function loadInjuryStatuses(
  admin: ReturnType<typeof createAdminClient>,
  leagueId: string,
  playerIds: (number | null)[],
): Promise<Map<number, string | null>> {
  const ids = playerIds.filter((id): id is number => id != null);
  const map = new Map<number, string | null>();
  if (ids.length === 0) return map;

  const { data } = await admin
    .from("league_roster_entries")
    .select("espn_player_id, injury_status")
    .eq("league_id", leagueId)
    .in("espn_player_id", ids);

  for (const row of data ?? []) {
    map.set(
      Number(row.espn_player_id),
      row.injury_status != null ? String(row.injury_status) : null,
    );
  }
  return map;
}

async function markInconclusive(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  syncedAt: string,
  syncKind: "full" | "light",
  notes: string,
  rcaCategory: "lack_of_information" | "skill_gap" | "chance" = "lack_of_information",
) {
  await admin
    .from("agent_recommendations")
    .update({
      status: "inconclusive",
      outcome_notes: notes,
      rca_category: rcaCategory,
      rca_notes: notes,
      rca_json: { reason: notes },
      resolved_at: syncedAt,
      truth_source: syncKind === "full" ? "espn_full" : "espn_light",
      data_as_of: syncedAt,
    })
    .eq("id", id);
}
