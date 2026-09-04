import { NextResponse } from "next/server";
import { authorizeCronRequest, cronAuthErrorResponse } from "@/lib/cron/auth";
import { runInstantRedditSpikeScan } from "@/lib/news/alerts";
import { runScheduledEspnRefresh } from "@/lib/espn/scheduled-sync";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * ESPN roster/injury refresh + Reddit spike scan.
 * Hobby: once daily via vercel.json. Hourly: enable the GitHub Actions workflow
 * `.github/workflows/hourly-league-refresh.yml` (or upgrade to Vercel Pro and
 * change the schedule below to `0 * * * *`).
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return cronAuthErrorResponse(auth.reason);
  }

  const espn = await runScheduledEspnRefresh();

  let reddit: Awaited<ReturnType<typeof runInstantRedditSpikeScan>> | { error: string };
  try {
    reddit = await runInstantRedditSpikeScan();
  } catch (err) {
    reddit = { error: err instanceof Error ? err.message : "reddit spike scan failed" };
  }

  return NextResponse.json({ ok: true, espn, reddit });
}
