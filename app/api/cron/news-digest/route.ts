import { NextResponse } from "next/server";
import { authorizeCronRequest, cronAuthErrorResponse } from "@/lib/cron/auth";
import { runDailyDigestsForCurrentHour, runInstantRedditSpikeScan } from "@/lib/news/alerts";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Daily (~13:00 UTC): digests for all enabled leagues + Reddit spike scan. */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return cronAuthErrorResponse(auth.reason);
  }

  const digest = await runDailyDigestsForCurrentHour();
  const reddit = await runInstantRedditSpikeScan();
  return NextResponse.json({ ok: true, digest, reddit });
}
