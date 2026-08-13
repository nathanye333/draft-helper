"use client";

import { useMemo } from "react";
import { Select } from "@/components/ui/select";
import type { Position } from "@/lib/supabase/types";

export const FILTER_POSITIONS: Array<Position | "ALL"> = [
  "ALL",
  "QB",
  "RB",
  "WR",
  "TE",
  "K",
  "DST",
];

export interface BoardFilterState {
  position: Position | "ALL";
  byeWeek: number | "ALL";
  nflTeam: string | "ALL";
}

export const DEFAULT_BOARD_FILTERS: BoardFilterState = {
  position: "ALL",
  byeWeek: "ALL",
  nflTeam: "ALL",
};

export function uniqueByeWeeks(players: { byeWeek: number | null }[]): number[] {
  return [
    ...new Set(players.map((p) => p.byeWeek).filter((w): w is number => w != null)),
  ].sort((a, b) => a - b);
}

export function uniqueNflTeams(players: { nflTeam: string | null }[]): string[] {
  return [
    ...new Set(players.map((p) => p.nflTeam).filter((t): t is string => Boolean(t))),
  ].sort((a, b) => a.localeCompare(b));
}

export function matchesBoardFilters<
  T extends { position: Position; byeWeek: number | null; nflTeam: string | null },
>(player: T, filters: BoardFilterState): boolean {
  if (filters.position !== "ALL" && player.position !== filters.position) return false;
  if (filters.byeWeek !== "ALL" && player.byeWeek !== filters.byeWeek) return false;
  if (filters.nflTeam !== "ALL" && player.nflTeam !== filters.nflTeam) return false;
  return true;
}

interface PlayerBoardFiltersProps {
  filters: BoardFilterState;
  onChange: (next: BoardFilterState) => void;
  byeWeeks: number[];
  nflTeams: string[];
  /** Compact layout for side panels */
  compact?: boolean;
}

export function PlayerBoardFilters({
  filters,
  onChange,
  byeWeeks,
  nflTeams,
  compact = false,
}: PlayerBoardFiltersProps) {
  const selectClass = compact ? "h-8 text-xs" : undefined;

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "grid gap-2 sm:grid-cols-3"}>
      <Select
        aria-label="Filter by position"
        className={selectClass}
        value={filters.position}
        onChange={(e) =>
          onChange({ ...filters, position: e.target.value as BoardFilterState["position"] })
        }
      >
        {FILTER_POSITIONS.map((p) => (
          <option key={p} value={p}>
            {p === "ALL" ? "All positions" : p}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by bye week"
        className={selectClass}
        value={filters.byeWeek === "ALL" ? "ALL" : String(filters.byeWeek)}
        onChange={(e) =>
          onChange({
            ...filters,
            byeWeek: e.target.value === "ALL" ? "ALL" : Number(e.target.value),
          })
        }
      >
        <option value="ALL">All bye weeks</option>
        {byeWeeks.map((w) => (
          <option key={w} value={w}>
            Bye {w}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by NFL team"
        className={selectClass}
        value={filters.nflTeam}
        onChange={(e) => onChange({ ...filters, nflTeam: e.target.value })}
      >
        <option value="ALL">All NFL teams</option>
        {nflTeams.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Convenience hook-like helper for building filter option lists from a player array. */
export function useBoardFilterOptions(players: { byeWeek: number | null; nflTeam: string | null }[]) {
  return useMemo(
    () => ({
      byeWeeks: uniqueByeWeeks(players),
      nflTeams: uniqueNflTeams(players),
    }),
    [players],
  );
}
