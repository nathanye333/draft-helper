import { NextResponse } from "next/server";
import {
  createLeagueChatSession,
  listLeagueChatSessions,
} from "@/lib/agent/league-chat-sessions";
import { fetchLeagueBundle } from "@/lib/league/data";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
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

  try {
    const sessions = await listLeagueChatSessions(supabase, leagueId);
    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list sessions";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function POST(
  _request: Request,
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

  try {
    const session = await createLeagueChatSession(supabase, {
      leagueId,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
