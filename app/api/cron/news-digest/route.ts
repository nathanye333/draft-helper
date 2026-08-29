import { NextResponse } from "next/server";
import { authorizeCronRequest, cronAuthErrorResponse } from "@/lib/cron/auth";
import { runDailyDigestsForCurrentHour, runInstantRedditSpikeScan } from "@/lib/news/alerts";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Daily (~13:00 UTC). Digests run the same refresh-then-send path as the
 * "Send digest now" button, so if the button works this does too.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return cronAuthErrorResponse(auth.reason);
  }

  const digest = await runDailyDigestsForCurrentHour();

  // Reddit spikes are a bonus; never let them mask the digest result.
  let reddit: Awaited<ReturnType<typeof runInstantRedditSpikeScan>> | { error: string };
  try {
    reddit = await runInstantRedditSpikeScan();
  } catch (err) {
    reddit = { error: err instanceof Error ? err.message : "reddit spike scan failed" };
  }

  return NextResponse.json({ ok: true, digest, reddit });
}
