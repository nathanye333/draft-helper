"use client";

import { PrefetchRoutes } from "@/components/prefetch-routes";

/**
 * From hub / leagues list: warm all candidate destinations to maximize
 * click-through speed once the user starts navigating.
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
