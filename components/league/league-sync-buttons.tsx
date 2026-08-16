"use client";

import { useState, useTransition } from "react";
import { refreshLeague, refreshLeagueProjections } from "@/app/actions/league";
import { Button } from "@/components/ui/button";

export function LeagueSyncButtons({ leagueId }: { leagueId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await refreshLeague(leagueId);
            setMessage(
              result.ok
                ? `ESPN synced · ${result.rosterCount} roster spots`
                : result.message,
            );
          });
        }}
      >
        {pending ? "Syncing…" : "Sync ESPN"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await refreshLeagueProjections(leagueId);
            setMessage(
              result.ok
                ? `Projections synced · ${result.playerCount} players`
                : result.message,
            );
          });
        }}
      >
        Sync projections
      </Button>
      {message ? <span className="text-xs text-slate-400">{message}</span> : null}
    </div>
  );
}
