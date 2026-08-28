import { NextResponse } from "next/server";
import { authorizeCronRequest, cronAuthErrorResponse } from "@/lib/cron/auth";
import { runInstantRedditSpikeScan } from "@/lib/news/alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Daily (Vercel Hobby): poll Reddit for roster spikes and email instant alerts. Pro can use a more frequent schedule in vercel.json. */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return cronAuthErrorResponse(auth.reason);
  }

  const result = await runInstantRedditSpikeScan();
  return NextResponse.json({ ok: true, ...result });
}
