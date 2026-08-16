import { createClient } from "@/lib/supabase/server";
import type { Player, PlayerRanking, ScoringFormat } from "@/lib/supabase/types";

export interface RankingWithPlayer extends PlayerRanking {
  players: Player;
}

/** PostgREST returns Postgres `numeric` as strings — coerce for math/sorting. */
function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeRanking(row: RankingWithPlayer): RankingWithPlayer {
  return {
    ...row,
    rank_ecr: toNum(row.rank_ecr),
    rank_adp: toNum(row.rank_adp),
    rank_min: toNum(row.rank_min),
    rank_max: toNum(row.rank_max),
    rank_std: toNum(row.rank_std),
    proj_points: toNum(row.proj_points),
    proj_stats:
      row.proj_stats && typeof row.proj_stats === "object"
        ? (row.proj_stats as Record<string, number>)
        : null,
  };
}

/**
 * Shared FantasyPros rankings board for a season + scoring format.
 * Used by drafts and season leagues.
 */
export async function fetchRankingsBoard(
  season: number,
  scoring: ScoringFormat,
  options: { includeProjStats?: boolean } = {},
): Promise<RankingWithPlayer[]> {
  const supabase = await createClient();

  const rankingSelect = options.includeProjStats
    ? "id, season, scoring, fp_player_id, rank_ecr, rank_adp, rank_min, rank_max, rank_std, tier, proj_points, proj_stats, synced_at, players(*)"
    : "id, season, scoring, fp_player_id, rank_ecr, rank_adp, rank_min, rank_max, rank_std, tier, proj_points, synced_at, players(*)";

  const { data, error } = await supabase
    .from("player_rankings")
    .select(rankingSelect)
    .eq("season", season)
    .eq("scoring", scoring)
    .order("rank_adp", { ascending: true });

  if (error) {
    throw new Error(`Failed to load rankings: ${error.message}`);
  }

  return ((data ?? []) as unknown as RankingWithPlayer[])
    .filter((r) => r.players != null)
    .map(normalizeRanking);
}
