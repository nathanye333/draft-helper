"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_BOARD_FILTERS,
  matchesBoardFilters,
  PlayerBoardFilters,
  useBoardFilterOptions,
  type BoardFilterState,
} from "@/components/draft-room/player-board-filters";
import type { Position } from "@/lib/supabase/types";

/** Local props shape — avoid importing server helper modules into this client file. */
interface RecommendationRow {
  fpPlayerId: string;
  name: string;
  position: Position;
  rationale: string;
  byeWeek: number | null;
  nflTeam: string | null;
  rankAdp: number | null;
}

export function RecommendationsPanel({ recommendations }: { recommendations: RecommendationRow[] }) {
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
