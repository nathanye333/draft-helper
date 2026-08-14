import { NextResponse } from "next/server";
import { createChatSession, listChatSessions } from "@/lib/agent/chat-sessions";
import { fetchDraftBundle } from "@/lib/draft/data";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await context.params;
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
    const sessions = await listChatSessions(supabase, draftId);
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
  const { id: draftId } = await context.params;
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
    const session = await createChatSession(supabase, {
      draftId,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create session";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
