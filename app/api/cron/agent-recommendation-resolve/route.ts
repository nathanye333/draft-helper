import { NextResponse } from "next/server";
import { authorizeCronRequest, cronAuthErrorResponse } from "@/lib/cron/auth";
import { resolveAllPendingRecommendations } from "@/lib/agent/recommendation-resolve";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * End-of-week recommendation verification + RCA.
 * Compares claims to actual ESPN week points and tags failures as
 * skill_gap | chance | lack_of_information.
 *
 * Schedule: Tue/Wed 16:00 UTC (after MNF + score finalization) via vercel.json.
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return cronAuthErrorResponse(auth.reason);
  }

  try {
    const result = await resolveAllPendingRecommendations({ syncKind: "full" });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "recommendation resolve failed",
      },
      { status: 500 },
    );
  }
}
