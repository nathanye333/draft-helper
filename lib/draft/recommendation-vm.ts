import type { Recommendation } from "@/lib/analytics/recommendations";
import type { Position } from "@/lib/supabase/types";

export interface RecommendationVM extends Recommendation {
  byeWeek: number | null;
  nflTeam: string | null;
  rankAdp: number | null;
}

/** Enrich scored recommendations with board metadata for filtering/display. */
export function toRecommendationVMs(
  recommendations: Recommendation[],
  availablePlayers: Array<{
    fpPlayerId: string;
    position: Position;
    byeWeek: number | null;
    nflTeam: string | null;
    rankAdp: number | null;
  }>,
): RecommendationVM[] {
  const byId = new Map(availablePlayers.map((p) => [p.fpPlayerId, p]));
  return recommendations.map((rec) => {
    const meta = byId.get(rec.fpPlayerId);
    return {
      ...rec,
      byeWeek: meta?.byeWeek ?? null,
      nflTeam: meta?.nflTeam ?? null,
      rankAdp: meta?.rankAdp ?? null,
    };
  });
}
