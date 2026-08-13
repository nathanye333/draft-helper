"use client";

import { useMemo, useState } from "react";
import type { Recommendation } from "@/lib/analytics/recommendations";
import type { Position } from "@/lib/supabase/types";
import {
  DEFAULT_BOARD_FILTERS,
  matchesBoardFilters,
  PlayerBoardFilters,
  useBoardFilterOptions,
  type BoardFilterState,
} from "@/components/draft-room/player-board-filters";

export interface RecommendationVM extends Recommendation {
  byeWeek: number | null;
  nflTeam: string | null;
  rankAdp: number | null;
}

export function RecommendationsPanel({ recommendations }: { recommendations: RecommendationVM[] }) {
  const [filters, setFilters] = useState<BoardFilterState>(DEFAULT_BOARD_FILTERS);
  const { byeWeeks, nflTeams } = useBoardFilterOptions(recommendations);

  const filtered = useMemo(
    () => recommendations.filter((r) => matchesBoardFilters(r, filters)),
    [recommendations, filters],
  );

  if (recommendations.length === 0) {
    return <p className="text-sm text-slate-500">No recommendations yet — sync rankings to enable this.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <PlayerBoardFilters
        compact
        filters={filters}
        onChange={setFilters}
        byeWeeks={byeWeeks}
        nflTeams={nflTeams}
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No recommendations match these filters.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {filtered.map((rec, i) => (
            <li key={rec.fpPlayerId} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="text-slate-500">{i + 1}.</span>
              <span className="font-medium text-slate-100">{rec.name}</span>
              <span className="text-xs text-slate-500">
                {rec.position}
                {rec.nflTeam ? ` · ${rec.nflTeam}` : ""}
                {rec.byeWeek != null ? ` · Bye ${rec.byeWeek}` : ""}
                {rec.rankAdp != null ? ` · ADP ${rec.rankAdp}` : ""}
              </span>
              <span className="text-xs text-slate-500">({rec.rationale})</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
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
