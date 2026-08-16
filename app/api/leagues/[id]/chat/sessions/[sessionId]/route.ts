import { NextResponse } from "next/server";
import {
  deleteLeagueChatSession,
  getLeagueChatSession,
} from "@/lib/agent/league-chat-sessions";
import { fetchLeagueBundle } from "@/lib/league/data";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id: leagueId, sessionId } = await context.params;
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
    const session = await getLeagueChatSession(supabase, sessionId);
    if (!session || session.leagueId !== leagueId) {
      return NextResponse.json({ ok: false, message: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load session";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id: leagueId, sessionId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const existing = await getLeagueChatSession(supabase, sessionId);
  if (!existing || existing.leagueId !== leagueId) {
    return NextResponse.json({ ok: false, message: "Session not found" }, { status: 404 });
  }

  try {
    await deleteLeagueChatSession(supabase, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete session";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
