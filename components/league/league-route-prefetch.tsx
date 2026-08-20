"use client";

import { useEffect } from "react";
import { PrefetchRoutes } from "@/components/prefetch-routes";

const TAB_SUFFIXES = ["", "/start-sit", "/trades", "/waivers", "/news"] as const;

/**
 * Prefetch all league tabs, and warm the server's in-memory news cache when
 * ESPN data is already synced.
 */
export function LeagueRoutePrefetch({
  leagueId,
  espnCached,
}: {
  leagueId: string;
  espnCached: boolean;
}) {
  const hrefs = TAB_SUFFIXES.map((suffix) => `/leagues/${leagueId}${suffix}`);

  useEffect(() => {
    if (!espnCached) return;

    const ctrl = new AbortController();
    void fetch(`/api/leagues/${leagueId}/news`, {
      signal: ctrl.signal,
      credentials: "same-origin",
    }).catch(() => {
      /* best-effort warm of in-memory news cache */
    });

    return () => ctrl.abort();
  }, [leagueId, espnCached]);

  return <PrefetchRoutes hrefs={hrefs} eager={espnCached} />;
}
