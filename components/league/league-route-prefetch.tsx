"use client";

import { useEffect } from "react";
import { PrefetchRoutes } from "@/components/prefetch-routes";

const TAB_SUFFIXES = ["", "/start-sit", "/trades", "/waivers", "/news"] as const;

/**
 * Prefetches all league tabs. When ESPN data is already in Postgres
 * (`espnCached`), runs immediately and also warms the news API cache.
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
