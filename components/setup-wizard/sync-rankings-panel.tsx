"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncDraftRankings, startDraft } from "@/app/actions/draft";
import { Button } from "@/components/ui/button";
import type { Position } from "@/lib/supabase/types";

interface TopAdpPlayer {
  fpPlayerId: string;
  rankAdp: number;
  name: string;
  position: Position;
  nflTeam: string | null;
}

interface SyncRankingsPanelProps {
  draftId: string;
  rankingCount: number;
  topByAdp: TopAdpPlayer[];
}

export function SyncRankingsPanel({ draftId, rankingCount, topByAdp }: SyncRankingsPanelProps) {
  const router = useRouter();
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
    try {
      await startDraft(draftId);
      router.push(`/drafts/${draftId}`);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to start draft",
      });
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button onClick={handleSync} disabled={syncing} variant="secondary">
          {syncing ? "Syncing…" : rankingCount > 0 ? "Refresh rankings" : "Sync rankings from FantasyPros"}
        </Button>
        {rankingCount > 0 && (
          <span className="text-sm text-slate-400">{rankingCount} players cached</span>
        )}
      </div>

      {message && (
        <p className={message.type === "success" ? "text-sm text-emerald-400" : "text-sm text-amber-400"}>
          {message.text}
        </p>
      )}

      {rankingCount === 0 && !message && (
        <p className="text-sm text-slate-500">
          No rankings synced yet. You can still start the draft and log picks without ADP/ECR data —
          reach/value badges will show &ldquo;No Data&rdquo; until rankings are synced.
        </p>
      )}

      {topByAdp.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-300">Top 10 by ADP</p>
          <ol className="flex flex-col gap-1 text-sm text-slate-400">
            {topByAdp.map((r) => (
              <li key={r.fpPlayerId}>
                {r.rankAdp}. {r.name} ({r.position} - {r.nflTeam ?? "FA"})
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
