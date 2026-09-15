import { NextResponse } from "next/server";
import { authorizeCronRequest, cronAuthErrorResponse } from "@/lib/cron/auth";
import { runSeasonSkillSleep } from "@/lib/agent/skill-sleep";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Weekly SkillOpt-Sleep for the season agent skill.
 * Schedule: Sundays 15:00 UTC via vercel.json.
 * Pass ?force=1 to run even with sparse evidence (manual/debug).
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return cronAuthErrorResponse(auth.reason);
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  try {
    const result = await runSeasonSkillSleep({ force });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "skill sleep failed",
      },
      { status: 500 },
    );
  }
}
