import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchConsensusRankings, FantasyProsApiError, normalizePosition, type FpPlayer } from "@/lib/fantasypros/client";

export type SyncRankingsResult =
  | { ok: true; playerCount: number; syncedAt: string }
  | { ok: false; reason: "not_configured" | "not_found" | "api_error"; message: string };

/**
 * Fetches ADP + ROS (ECR) consensus rankings from FantasyPros for the given
 * draft's season/scoring and upserts them into `players` + `player_rankings`.
 * Requires the caller to be authenticated as the draft's owner (verified via
 * RLS on the read) but writes with the service-role client since `players`
 * is a shared table regular users cannot write to directly.
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

  if (!process.env.FANTASYPROS_API_KEY) {
    return {
      ok: false,
      reason: "not_configured",
      message: "FANTASYPROS_API_KEY is not set. Add it to run rankings sync.",
    };
  }

  let adpPlayers: FpPlayer[];
  let rosPlayers: FpPlayer[];
  try {
    [adpPlayers, rosPlayers] = await Promise.all([
      fetchConsensusRankings({ season: draft.season, scoring: draft.scoring, type: "ADP" }),
      fetchConsensusRankings({ season: draft.season, scoring: draft.scoring, type: "ROS" }),
    ]);
  } catch (err) {
    const message = err instanceof FantasyProsApiError ? err.message : "Unknown FantasyPros error";
    return { ok: false, reason: "api_error", message };
  }

  const admin = createAdminClient();

  const playersById = new Map<string, FpPlayer>();
  for (const p of [...rosPlayers, ...adpPlayers]) {
    if (!playersById.has(p.player_id)) playersById.set(p.player_id, p);
  }

  const playerRows = Array.from(playersById.values()).map((p) => ({
    fp_player_id: p.player_id,
    name: p.player_name,
    position: normalizePosition(p.player_position_id),
    nfl_team: p.player_team_id ?? null,
    bye_week: p.player_bye_week != null ? Number(p.player_bye_week) : null,
  }));

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
    return {
      draft_id: draftId,
      fp_player_id: fpPlayerId,
      rank_adp: adp ? adp.rank_ecr : null,
      rank_ecr: ros ? ros.rank_ecr : null,
      rank_min: ros?.rank_min != null ? Number(ros.rank_min) : null,
      rank_max: ros?.rank_max != null ? Number(ros.rank_max) : null,
      rank_std: ros?.rank_std != null ? Number(ros.rank_std) : null,
      tier: ros?.tier != null ? Number(ros.tier) : null,
      synced_at: syncedAt,
    };
  });

  if (rankingRows.length > 0) {
    const { error } = await admin
      .from("player_rankings")
      .upsert(rankingRows, { onConflict: "draft_id,fp_player_id" });
    if (error) return { ok: false, reason: "api_error", message: `Failed to save rankings: ${error.message}` };
  }

  return { ok: true, playerCount: rankingRows.length, syncedAt };
}
