import { createClient } from "@/lib/supabase/server";
import {
  computeConsistency,
  type ConsistencyStats,
} from "@/lib/analytics/consistency";

/**
 * Load weekly actual fantasy points (week ≥ 1) for consistency analysis.
 * Prefers current season; if fewer than `minGames` samples, appends prior season.
 */
export async function fetchConsistencyByEspnIds(params: {
  leagueId: string;
  season: number;
  espnPlayerIds: number[];
  minGames?: number;
}): Promise<Map<number, ConsistencyStats>> {
  const out = new Map<number, ConsistencyStats>();
  const ids = [...new Set(params.espnPlayerIds)].filter((id) => Number.isFinite(id));
  if (ids.length === 0) return out;

  const supabase = await createClient();
  const minGames = params.minGames ?? 3;
  const seasons = [params.season, params.season - 1];

  const { data, error } = await supabase
    .from("espn_player_week_points")
    .select("espn_player_id, season, week, actual_points")
    .eq("league_id", params.leagueId)
    .in("espn_player_id", ids)
    .in("season", seasons)
    .gte("week", 1)
    .not("actual_points", "is", null)
    .order("season", { ascending: false })
    .order("week", { ascending: true });

  if (error) {
    throw new Error(`Failed to load week points: ${error.message}`);
  }

  const byPlayer = new Map<number, { season: number; week: number; actual: number }[]>();
  for (const row of data ?? []) {
    const espnId = Number(row.espn_player_id);
    const actual = Number(row.actual_points);
    if (!Number.isFinite(actual)) continue;
    const list = byPlayer.get(espnId) ?? [];
    list.push({
      season: Number(row.season),
      week: Number(row.week),
      actual,
    });
    byPlayer.set(espnId, list);
  }

  for (const id of ids) {
    const rows = byPlayer.get(id) ?? [];
    const current = rows.filter((r) => r.season === params.season).map((r) => r.actual);
    let samples = current;
    if (samples.length < minGames) {
      const prior = rows.filter((r) => r.season === params.season - 1).map((r) => r.actual);
      samples = [...current, ...prior];
    }
    out.set(id, computeConsistency(samples));
  }

  return out;
}
