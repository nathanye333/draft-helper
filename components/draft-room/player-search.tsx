"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { logPick } from "@/app/actions/draft";
import {
  DEFAULT_BOARD_FILTERS,
  matchesBoardFilters,
  PlayerBoardFilters,
  useBoardFilterOptions,
  type BoardFilterState,
} from "@/components/draft-room/player-board-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AvailablePlayerVM } from "@/lib/draft/view";
import type { DraftTeam } from "@/lib/supabase/types";

interface PlayerSearchProps {
  draftId: string;
  availablePlayers: AvailablePlayerVM[];
  teams: DraftTeam[];
  defaultTeamId: string | null;
}

type SortKey = "adp" | "ecr" | "name";

export function PlayerSearch({ draftId, availablePlayers, teams, defaultTeamId }: PlayerSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState(defaultTeamId ?? teams[0]?.id ?? "");
  const [drafting, setDrafting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BoardFilterState>(DEFAULT_BOARD_FILTERS);
  const [sortBy, setSortBy] = useState<SortKey>("adp");
  const { byeWeeks, nflTeams } = useBoardFilterOptions(availablePlayers);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = availablePlayers.filter((p) => {
      if (!matchesBoardFilters(p, filters)) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "ecr") return (a.rankEcr ?? Infinity) - (b.rankEcr ?? Infinity);
      return (a.rankAdp ?? Infinity) - (b.rankAdp ?? Infinity);
    });

    return filtered.slice(0, 50);
  }, [availablePlayers, query, filters, sortBy]);

  async function handleDraft(fpPlayerId: string) {
    setDrafting(fpPlayerId);
    setError(null);
    try {
      await logPick({ draftId, fpPlayerId, teamId: teamId || undefined });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log pick");
    } finally {
      setDrafting(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        autoFocus
        placeholder="Type a player name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <PlayerBoardFilters
        compact
        filters={filters}
        onChange={setFilters}
        byeWeeks={byeWeeks}
        nflTeams={nflTeams}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap text-xs text-slate-500">Sort:</span>
        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="h-8 text-xs"
        >
          <option value="adp">ADP</option>
          <option value="ecr">ECR</option>
          <option value="name">Name</option>
        </Select>
        <span className="whitespace-nowrap text-xs text-slate-500">Draft to:</span>
        <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-8 text-xs">
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.is_user_team ? " (you)" : ""}
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <p className="text-xs text-slate-500">
        Showing {results.length}
        {results.length === 50 ? "+" : ""} of {availablePlayers.length} available
      </p>

      <ul className="flex max-h-[28rem] flex-col divide-y divide-slate-800 overflow-y-auto">
        {results.map((p) => (
          <li key={p.fpPlayerId} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{p.name}</p>
              <p className="text-xs text-slate-500">
                {p.position} · {p.nflTeam ?? "FA"}
                {p.byeWeek != null ? ` · Bye ${p.byeWeek}` : ""}
                {p.draftYear != null ? ` · ${p.draftYear}` : ""}
                {p.rankAdp != null ? ` · ADP ${p.rankAdp}` : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={drafting === p.fpPlayerId}
              onClick={() => handleDraft(p.fpPlayerId)}
            >
              {drafting === p.fpPlayerId ? "…" : "Draft"}
            </Button>
          </li>
        ))}
        {results.length === 0 && (
          <li className="py-4 text-center text-sm text-slate-500">No matching players available.</li>
        )}
      </ul>
    </div>
  );
}
