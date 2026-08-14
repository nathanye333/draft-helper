import { NextResponse } from "next/server";
import { deleteChatSession, getChatSession } from "@/lib/agent/chat-sessions";
import { fetchDraftBundle } from "@/lib/draft/data";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; sessionId: string }> },
) {
  const { id: draftId, sessionId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const bundle = await fetchDraftBundle(draftId);
  if (!bundle) {
    return NextResponse.json({ ok: false, message: "Draft not found" }, { status: 404 });
  }

  try {
    const session = await getChatSession(supabase, sessionId);
    if (!session || session.draftId !== draftId) {
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
  const { id: draftId, sessionId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const existing = await getChatSession(supabase, sessionId);
  if (!existing || existing.draftId !== draftId) {
    return NextResponse.json({ ok: false, message: "Session not found" }, { status: 404 });
  }

  try {
    await deleteChatSession(supabase, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete session";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
