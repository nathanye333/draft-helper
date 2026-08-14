import type { SupabaseClient } from "@supabase/supabase-js";

export interface StoredToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  status: "running" | "done";
}

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  toolCalls?: StoredToolCall[] | null;
  stopped?: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface ChatSessionSummary {
  id: string;
  draftId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: StoredChatMessage[];
}

type SessionRow = {
  id: string;
  draft_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  reasoning: string | null;
  tool_calls: StoredToolCall[] | null;
  stopped: boolean;
  sort_order: number;
  created_at: string;
};

export function titleFromFirstMessage(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (!oneLine) return "New chat";
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

export function isDefaultSessionTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed === "New chat" || /^Chat \d+$/.test(trimmed);
}

export function numberedSessionTitle(existingCount: number): string {
  return `Chat ${Math.max(1, existingCount + 1)}`;
}

function mapSession(row: SessionRow, messageCount = 0): ChatSessionSummary {
  return {
    id: row.id,
    draftId: row.draft_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount,
  };
}

function mapMessage(row: MessageRow): StoredChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning,
    toolCalls: row.tool_calls,
    stopped: row.stopped,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export async function listChatSessions(
  supabase: SupabaseClient,
  draftId: string,
): Promise<ChatSessionSummary[]> {
  const { data, error } = await supabase
    .from("draft_agent_sessions")
    .select("id, draft_id, title, created_at, updated_at, draft_agent_messages(count)")
    .eq("draft_id", draftId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const countRow = row as SessionRow & {
      draft_agent_messages?: { count: number }[];
    };
    const messageCount = countRow.draft_agent_messages?.[0]?.count ?? 0;
    return mapSession(countRow, messageCount);
  });
}

export async function createChatSession(
  supabase: SupabaseClient,
  params: { draftId: string; userId: string; title?: string },
): Promise<ChatSessionSummary> {
  let title = params.title?.trim();
  if (!title) {
    const { count, error: countError } = await supabase
      .from("draft_agent_sessions")
      .select("id", { count: "exact", head: true })
      .eq("draft_id", params.draftId);
    if (countError) throw new Error(countError.message);
    title = numberedSessionTitle(count ?? 0);
  }

  const { data, error } = await supabase
    .from("draft_agent_sessions")
    .insert({
      draft_id: params.draftId,
      user_id: params.userId,
      title,
    })
    .select("id, draft_id, title, created_at, updated_at")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create chat session");
  return mapSession(data as SessionRow, 0);
}

export async function getChatSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<ChatSessionDetail | null> {
  const { data: session, error: sessionError } = await supabase
    .from("draft_agent_sessions")
    .select("id, draft_id, title, created_at, updated_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) throw new Error(sessionError.message);
  if (!session) return null;

  const { data: messages, error: messagesError } = await supabase
    .from("draft_agent_messages")
    .select("id, session_id, role, content, reasoning, tool_calls, stopped, sort_order, created_at")
    .eq("session_id", sessionId)
    .order("sort_order", { ascending: true });

  if (messagesError) throw new Error(messagesError.message);

  const mapped = (messages ?? []).map((m) => mapMessage(m as MessageRow));
  return {
    ...mapSession(session as SessionRow, mapped.length),
    messages: mapped,
  };
}

export async function deleteChatSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await supabase.from("draft_agent_sessions").delete().eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export interface PersistTurnInput {
  userContent: string;
  assistant: {
    content: string;
    reasoning?: string;
    toolCalls?: StoredToolCall[];
    stopped?: boolean;
  };
}

/** Append one user/assistant turn and bump session updated_at. */
export async function appendChatTurn(
  supabase: SupabaseClient,
  sessionId: string,
  turn: PersistTurnInput,
): Promise<void> {
  const { data: session, error: sessionError } = await supabase
    .from("draft_agent_sessions")
    .select("id, title")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message ?? "Chat session not found");
  }

  const { count, error: countError } = await supabase
    .from("draft_agent_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  if (countError) throw new Error(countError.message);

  const baseOrder = count ?? 0;
  const rows = [
    {
      session_id: sessionId,
      role: "user" as const,
      content: turn.userContent,
      reasoning: null,
      tool_calls: null,
      stopped: false,
      sort_order: baseOrder,
    },
    {
      session_id: sessionId,
      role: "assistant" as const,
      content: turn.assistant.content,
      reasoning: turn.assistant.reasoning || null,
      tool_calls: turn.assistant.toolCalls?.length ? turn.assistant.toolCalls : null,
      stopped: Boolean(turn.assistant.stopped),
      sort_order: baseOrder + 1,
    },
  ];

  const { error: insertError } = await supabase.from("draft_agent_messages").insert(rows);
  if (insertError) throw new Error(insertError.message);

  const patch: { updated_at: string; title?: string } = {
    updated_at: new Date().toISOString(),
  };
  if (isDefaultSessionTitle(session.title) && turn.userContent.trim()) {
    patch.title = titleFromFirstMessage(turn.userContent);
  }

  const { error: updateError } = await supabase
    .from("draft_agent_sessions")
    .update(patch)
    .eq("id", sessionId);

  if (updateError) throw new Error(updateError.message);
}
