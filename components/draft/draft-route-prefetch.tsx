"use client";

import { PrefetchRoutes } from "@/components/prefetch-routes";

/**
 * Prefetches draft room sibling routes so Board / Analysis / Room switches
 * are warm after the first page load.
 */
export function DraftRoutePrefetch({ draftId }: { draftId: string }) {
  const hrefs = [
    `/drafts/${draftId}`,
    `/drafts/${draftId}/board`,
    `/drafts/${draftId}/analysis`,
    `/drafts/${draftId}/setup`,
  ];

  return <PrefetchRoutes hrefs={hrefs} eager />;
}
