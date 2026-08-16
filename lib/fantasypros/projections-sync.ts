import { createAdminClient } from "@/lib/supabase/admin";
import {
  FantasyProsApiError,
  fetchProjections,
  normalizePosition,
  scoringAwareProjectedPoints,
  type FpScoring,
} from "@/lib/fantasypros/client";

export type SyncProjectionsResult =
  | { ok: true; playerCount: number; weeks: number[]; syncedAt: string }
  | { ok: false; reason: "api_error"; message: string };

/**
 * Upsert FantasyPros projections for the given season/scoring/weeks.
 * week 0 = season-long / ROS; 1–18 = weekly.
 * Also upserts minimal player rows so FK constraints succeed.
 */
export async function syncProjectionsForSeason(params: {
  season: number;
  scoring: FpScoring;
  weeks: number[];
}): Promise<SyncProjectionsResult> {
  const admin = createAdminClient();
  const syncedAt = new Date().toISOString();
  let playerCount = 0;

  try {
    for (const week of params.weeks) {
      const projections = await fetchProjections({
        season: params.season,
        scoring: params.scoring,
        week,
      });

      if (projections.length === 0) continue;

      const playerRows = projections.map((p) => ({
        fp_player_id: p.playerId,
        name: p.name,
        position: normalizePosition(p.position),
        nfl_team: p.nflTeam,
      }));

      const { error: playersError } = await admin
        .from("players")
        .upsert(playerRows, { onConflict: "fp_player_id" });
      if (playersError) {
        return { ok: false, reason: "api_error", message: playersError.message };
      }

      const projRows = projections.map((p) => ({
        fp_player_id: p.playerId,
        season: params.season,
        week,
        scoring: params.scoring,
        proj_points: scoringAwareProjectedPoints(p.stats, params.scoring),
        proj_stats: p.stats,
        synced_at: syncedAt,
      }));

      const { error: projError } = await admin
        .from("player_projections_weekly")
        .upsert(projRows, { onConflict: "fp_player_id,season,week,scoring" });
      if (projError) {
        return { ok: false, reason: "api_error", message: projError.message };
      }

      playerCount = Math.max(playerCount, projections.length);
    }
  } catch (err) {
    const message = err instanceof FantasyProsApiError ? err.message : "Unknown FantasyPros error";
    return { ok: false, reason: "api_error", message };
  }

  return { ok: true, playerCount, weeks: params.weeks, syncedAt };
}
