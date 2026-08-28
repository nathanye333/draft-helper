import { NextResponse } from "next/server";
import { runDailyDigestsForCurrentHour, runInstantRedditSpikeScan } from "@/lib/news/alerts";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/** Daily (~13:00 UTC): digests for all enabled leagues + Reddit spike scan. */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        hint: "Set CRON_SECRET in Vercel project env (Vercel sends Authorization: Bearer <CRON_SECRET>).",
      },
      { status: 401 },
    );
  }

  const digest = await runDailyDigestsForCurrentHour();
  const reddit = await runInstantRedditSpikeScan();
  return NextResponse.json({ ok: true, digest, reddit });
}
