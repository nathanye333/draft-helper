import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle } from "@/lib/league/data";

const bodySchema = z.object({
  messageId: z.string().uuid(),
  rating: z.enum(["up", "down"]),
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const bundle = await fetchLeagueBundle(leagueId);
  if (!bundle) {
    return NextResponse.json({ ok: false, message: "League not found" }, { status: 404 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { messageId, rating, reason } = parsed.data;

  const { data: message } = await supabase
    .from("league_agent_messages")
    .select("id, role, session_id")
    .eq("id", messageId)
    .maybeSingle();

  if (!message || message.role !== "assistant") {
    return NextResponse.json({ ok: false, message: "Message not found" }, { status: 404 });
  }

  const { data: session } = await supabase
    .from("league_agent_sessions")
    .select("id, league_id, user_id")
    .eq("id", message.session_id)
    .maybeSingle();

  if (!session || session.league_id !== leagueId || session.user_id !== user.id) {
    return NextResponse.json({ ok: false, message: "Message not found" }, { status: 404 });
  }

  const { error } = await supabase.from("agent_message_feedback").upsert(
    {
      message_id: messageId,
      user_id: user.id,
      rating,
      reason: reason?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "message_id,user_id" },
  );

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rating });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const bundle = await fetchLeagueBundle(leagueId);
  if (!bundle) {
    return NextResponse.json({ ok: false, message: "League not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const messageIds = url.searchParams.get("messageIds")?.split(",").filter(Boolean) ?? [];
  if (messageIds.length === 0) {
    return NextResponse.json({ ok: true, feedback: {} });
  }

  const { data } = await supabase
    .from("agent_message_feedback")
    .select("message_id, rating")
    .eq("user_id", user.id)
    .in("message_id", messageIds.slice(0, 100));

  const feedback: Record<string, "up" | "down"> = {};
  for (const row of data ?? []) {
    feedback[String(row.message_id)] = row.rating as "up" | "down";
  }

  return NextResponse.json({ ok: true, feedback });
}
