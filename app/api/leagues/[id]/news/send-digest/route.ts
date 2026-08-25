import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendDigestForLeague } from "@/lib/news/alerts";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Owner-triggered digest send (bypasses daily cron dedupe). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!league) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await sendDigestForLeague({
      leagueId,
      userId: userData.user.id,
      force: true,
    });

    if (result.sent) {
      return NextResponse.json({ ok: true, sent: true });
    }
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({ ok: true, sent: false, skipped: true });
    }
    return NextResponse.json(
      { error: "error" in result ? result.error : "Send failed" },
      { status: 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Digest send failed" },
      { status: 500 },
    );
  }
}
