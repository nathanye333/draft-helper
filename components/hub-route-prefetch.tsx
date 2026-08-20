"use client";

import { PrefetchRoutes } from "@/components/prefetch-routes";

/**
 * From hub / leagues list: eagerly warm league overviews when ESPN is synced,
 * and lightly warm draft entry points. Full tab prefetch happens inside the
 * league segment layout once the user opens a league.
 */
export function HubRoutePrefetch({
  syncedLeagueIds,
  draftHrefs,
}: {
  syncedLeagueIds: readonly string[];
  draftHrefs?: readonly string[];
}) {
  const leagueHrefs = syncedLeagueIds.map((id) => `/leagues/${id}`);
  const hrefs = [...leagueHrefs, ...(draftHrefs ?? [])];
  if (hrefs.length === 0) return null;

  return <PrefetchRoutes hrefs={hrefs} eager={syncedLeagueIds.length > 0} />;
}
