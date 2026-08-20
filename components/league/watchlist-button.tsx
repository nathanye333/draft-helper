"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function WatchlistButton({
  leagueId,
  espnPlayerId,
  playerName,
  initialWatched,
  size = "sm",
}: {
  leagueId: string;
  espnPlayerId: number;
  playerName: string;
  initialWatched: boolean;
  size?: "sm" | "default";
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    setPending(true);
    try {
      const res = watched
        ? await fetch(
            `/api/leagues/${leagueId}/watchlist?espnPlayerId=${espnPlayerId}`,
            { method: "DELETE" },
          )
        : await fetch(`/api/leagues/${leagueId}/watchlist`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ espnPlayerId, playerName }),
          });
      if (!res.ok) return;
      setWatched(!watched);
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={watched ? "secondary" : "outline"}
      disabled={pending}
      onClick={() => void toggle()}
    >
      {watched ? "On watchlist" : "Watchlist"}
    </Button>
  );
}
