"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { logPick } from "@/app/actions/draft";
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

export function PlayerSearch({ draftId, availablePlayers, teams, defaultTeamId }: PlayerSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState(defaultTeamId ?? teams[0]?.id ?? "");
  const [drafting, setDrafting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const sorted = [...availablePlayers].sort(
      (a, b) => (a.rankAdp ?? Infinity) - (b.rankAdp ?? Infinity),
    );
    if (!query.trim()) return sorted.slice(0, 25);
    const q = query.trim().toLowerCase();
    return sorted.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 25);
  }, [availablePlayers, query]);

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

      <div className="flex items-center gap-2">
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

      <ul className="flex max-h-[28rem] flex-col divide-y divide-slate-800 overflow-y-auto">
        {results.map((p) => (
          <li key={p.fpPlayerId} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{p.name}</p>
              <p className="text-xs text-slate-500">
                {p.position} · {p.nflTeam ?? "FA"}
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
