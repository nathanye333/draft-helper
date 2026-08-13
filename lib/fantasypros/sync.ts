import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  fetchConsensusRankings,
  fetchProjections,
  FantasyProsApiError,
  normalizePosition,
  scoringAwareProjectedPoints,
  type FpPlayer,
  type FpScoring,
} from "@/lib/fantasypros/client";

export type SyncRankingsResult =
  | { ok: true; playerCount: number; syncedAt: string }
  | { ok: false; reason: "not_configured" | "not_found" | "api_error"; message: string };

/**
 * Fetches ADP + ROS (ECR) consensus rankings and season projections from
 * FantasyPros for the given draft's season/scoring and upserts them into
 * `players` + `player_rankings` (including proj_points / proj_stats).
 */
export async function syncRankingsForDraft(draftId: string): Promise<SyncRankingsResult> {
  const supabase = await createClient();
  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("id, season, scoring")
    .eq("id", draftId)
    .single();

  if (draftError || !draft) {
    return { ok: false, reason: "not_found", message: "Draft not found or not accessible." };
  }

  const scoring = draft.scoring as FpScoring;

  let adpPlayers: FpPlayer[];
  let rosPlayers: FpPlayer[];
  let projections: Awaited<ReturnType<typeof fetchProjections>>;
  try {
    [adpPlayers, rosPlayers, projections] = await Promise.all([
      fetchConsensusRankings({ season: draft.season, scoring, type: "ADP" }),
      // DRAFT = preseason ECR (full board); ROS can be thinner early in the offseason.
      fetchConsensusRankings({ season: draft.season, scoring, type: "DRAFT" }),
      fetchProjections({ season: draft.season, scoring, week: 0 }),
    ]);
  } catch (err) {
    const message = err instanceof FantasyProsApiError ? err.message : "Unknown FantasyPros error";
    return { ok: false, reason: "api_error", message };
  }

  if (adpPlayers.length < 50) {
    return {
      ok: false,
      reason: "api_error",
      message: `FantasyPros returned only ${adpPlayers.length} ADP players — refusing to overwrite rankings with a truncated board.`,
    };
  }

  const admin = createAdminClient();

  const playersById = new Map<string, FpPlayer>();
  for (const p of [...rosPlayers, ...adpPlayers]) {
    if (!playersById.has(p.player_id)) playersById.set(p.player_id, p);
  }

  for (const p of projections) {
    if (playersById.has(p.playerId)) continue;
    playersById.set(p.playerId, {
      player_id: p.playerId,
      player_name: p.name,
      player_team_id: p.nflTeam,
      player_position_id: p.position,
      player_bye_week: null,
      rank_ecr: Number.NaN,
      rank_min: null,
      rank_max: null,
      rank_std: null,
      tier: null,
    });
  }

  const projById = new Map(projections.map((p) => [p.playerId, p]));

  const playerRows = Array.from(playersById.values()).map((p) => {
    const fromProj = projById.get(p.player_id);
    return {
      fp_player_id: p.player_id,
      name: p.player_name || fromProj?.name || p.player_id,
      position: normalizePosition(p.player_position_id || fromProj?.position || "UNK"),
      nfl_team: p.player_team_id ?? fromProj?.nflTeam ?? null,
      bye_week: p.player_bye_week != null ? Number(p.player_bye_week) : null,
    };
  });

  if (playerRows.length > 0) {
    const { error } = await admin.from("players").upsert(playerRows, { onConflict: "fp_player_id" });
    if (error) return { ok: false, reason: "api_error", message: `Failed to save players: ${error.message}` };
  }

  const adpById = new Map(adpPlayers.map((p) => [p.player_id, p]));
  const rosById = new Map(rosPlayers.map((p) => [p.player_id, p]));
  const syncedAt = new Date().toISOString();

  const rankingRows = Array.from(playersById.keys()).map((fpPlayerId) => {
    const adp = adpById.get(fpPlayerId);
    const ros = rosById.get(fpPlayerId);
    const proj = projById.get(fpPlayerId);
    const stats = proj?.stats ?? null;
    return {
      draft_id: draftId,
      fp_player_id: fpPlayerId,
      rank_adp: adp ? adp.rank_ecr : null,
      rank_ecr: ros && Number.isFinite(ros.rank_ecr) ? ros.rank_ecr : null,
      rank_min: ros?.rank_min != null ? Number(ros.rank_min) : null,
      rank_max: ros?.rank_max != null ? Number(ros.rank_max) : null,
      rank_std: ros?.rank_std != null ? Number(ros.rank_std) : null,
      tier: ros?.tier != null ? Number(ros.tier) : null,
      proj_points: stats ? scoringAwareProjectedPoints(stats, scoring) : null,
      proj_stats: stats,
      synced_at: syncedAt,
    };
  });

  if (rankingRows.length > 0) {
    const { error } = await admin
      .from("player_rankings")
      .upsert(rankingRows, { onConflict: "draft_id,fp_player_id" });
    if (error) return { ok: false, reason: "api_error", message: `Failed to save rankings: ${error.message}` };

    // Drop stale rows left over from a prior truncated sync.
    const keepIds = new Set(rankingRows.map((r) => r.fp_player_id));
    const { data: existing } = await admin
      .from("player_rankings")
      .select("fp_player_id")
      .eq("draft_id", draftId);
    const staleIds = (existing ?? [])
      .map((r) => r.fp_player_id as string)
      .filter((id) => !keepIds.has(id));
    if (staleIds.length > 0) {
      const { error: cleanupError } = await admin
        .from("player_rankings")
        .delete()
        .eq("draft_id", draftId)
        .in("fp_player_id", staleIds);
      if (cleanupError) {
        console.warn("Failed to prune stale rankings:", cleanupError.message);
      }
    }
  }

  return { ok: true, playerCount: rankingRows.length, syncedAt };
}
