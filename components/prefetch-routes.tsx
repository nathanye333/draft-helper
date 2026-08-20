"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

function scheduleIdle(cb: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(id);
  }

  const t = window.setTimeout(cb, 200);
  return () => window.clearTimeout(t);
}

/**
 * Proactively warms Next.js App Router RSC payloads for the given hrefs.
 * Use `eager` when backing data is already cached (e.g. ESPN sync present)
 * so navigation feels instant instead of waiting for idle.
 */
export function PrefetchRoutes({
  hrefs,
  eager = false,
}: {
  hrefs: readonly string[];
  eager?: boolean;
}) {
  const router = useRouter();
  const key = hrefs.join("\0");

  useEffect(() => {
    const unique = [...new Set(hrefs.filter(Boolean))];
    if (unique.length === 0) return;

    const run = () => {
      for (const href of unique) {
        void router.prefetch(href);
      }
    };

    if (eager) {
      run();
      return;
    }
    return scheduleIdle(run);
    // key captures hrefs without depending on array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, eager, key]);

  return null;
}
