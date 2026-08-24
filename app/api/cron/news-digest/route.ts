import { NextResponse } from "next/server";
import { runDailyDigestsForCurrentHour } from "@/lib/news/alerts";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/** Hourly: send digests for leagues whose digest_hour_utc matches the current UTC hour. */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDailyDigestsForCurrentHour();
  return NextResponse.json({ ok: true, ...result });
}
