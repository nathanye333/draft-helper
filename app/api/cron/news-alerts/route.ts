import { NextResponse } from "next/server";
import { authorizeCronRequest, cronAuthErrorResponse } from "@/lib/cron/auth";
import { runInstantRedditSpikeScan } from "@/lib/news/alerts";
import {
  runScheduledEspnRefresh,
  type EspnSyncKind,
} from "@/lib/espn/scheduled-sync";

export const runtime = "nodejs";
/** Full ESPN sync (player universe + FP projections) can exceed 60s with many leagues. */
export const maxDuration = 300;

/**
 * ESPN refresh + Reddit spike scan.
 * Daily Vercel cron: full sync (rosters, week points, FP projections).
 * Hourly GH Actions: pass ?espnSync=light for injury/roster-only refresh.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return cronAuthErrorResponse(auth.reason);
  }

  const url = new URL(request.url);
  const syncParam = url.searchParams.get("espnSync")?.trim().toLowerCase();
  const syncKind: EspnSyncKind = syncParam === "light" ? "light" : "full";

  const espn = await runScheduledEspnRefresh({ syncKind });

  let reddit: Awaited<ReturnType<typeof runInstantRedditSpikeScan>> | { error: string };
  try {
    reddit = await runInstantRedditSpikeScan();
  } catch (err) {
    reddit = { error: err instanceof Error ? err.message : "reddit spike scan failed" };
  }

  return NextResponse.json({ ok: true, espn, reddit });
}
