"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncDraftRankings, startDraft } from "@/app/actions/draft";
import { Button } from "@/components/ui/button";
import type { RankingWithPlayer } from "@/lib/draft/data";

interface SyncRankingsPanelProps {
  draftId: string;
  initialRankings: RankingWithPlayer[];
}

export function SyncRankingsPanel({ draftId, initialRankings }: SyncRankingsPanelProps) {
  const router = useRouter();
  const rankings = initialRankings;
  const [syncing, setSyncing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    const result = await syncDraftRankings(draftId);
    if (result.ok) {
      setMessage({ type: "success", text: `Synced ${result.playerCount} players from FantasyPros.` });
      router.refresh();
    } else {
      setMessage({ type: "error", text: result.message });
    }
    setSyncing(false);
  }

  async function handleStart() {
    setStarting(true);
    await startDraft(draftId);
    router.push(`/drafts/${draftId}`);
  }

  const topPlayers = [...rankings]
    .filter((r) => r.rank_adp != null)
    .sort((a, b) => (a.rank_adp ?? Infinity) - (b.rank_adp ?? Infinity))
    .slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={handleSync} disabled={syncing} variant="secondary">
          {syncing ? "Syncing…" : rankings.length > 0 ? "Refresh rankings" : "Sync rankings from FantasyPros"}
        </Button>
        {rankings.length > 0 && (
          <span className="text-sm text-slate-400">{rankings.length} players cached</span>
        )}
      </div>

      {message && (
        <p className={message.type === "success" ? "text-sm text-emerald-400" : "text-sm text-amber-400"}>
          {message.text}
        </p>
      )}

      {rankings.length === 0 && !message && (
        <p className="text-sm text-slate-500">
          No rankings synced yet. You can still start the draft and log picks without ADP/ECR data —
          reach/value badges will show &ldquo;No Data&rdquo; until rankings are synced.
        </p>
      )}

      {topPlayers.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-300">Top 10 by ADP</p>
          <ol className="flex flex-col gap-1 text-sm text-slate-400">
            {topPlayers.map((r) => (
              <li key={r.fp_player_id}>
                {r.rank_adp}. {r.players.name} ({r.players.position} - {r.players.nfl_team ?? "FA"})
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button onClick={handleStart} disabled={starting}>
          {starting ? "Starting…" : "Start draft"}
        </Button>
      </div>
    </div>
  );
}
