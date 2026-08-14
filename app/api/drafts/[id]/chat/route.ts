import { NextResponse } from "next/server";
import { z } from "zod";
import { streamDraftChatAgent } from "@/lib/agent/create-agent";
import {
  appendChatTurn,
  createChatSession,
  getChatSession,
  type StoredToolCall,
} from "@/lib/agent/chat-sessions";
import type { DraftAgentStreamEvent } from "@/lib/agent/stream-types";
import { resolveOpenAiApiKey } from "@/lib/agent/server-llm";
import { fetchDraftBundle } from "@/lib/draft/data";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const chatBodySchema = z.object({
  sessionId: z.string().uuid().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
  provider: z.enum(["openai", "ollama"]),
  model: z.string().min(1).max(200),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
});

function encodeEvent(event: DraftAgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function POST(
  request: Request,
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

  const raw = await request.json().catch(() => null);
  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { messages, provider, model, baseUrl, apiKey: clientApiKey, sessionId: bodySessionId } =
    parsed.data;
  const apiKey =
    provider === "openai"
      ? resolveOpenAiApiKey(user.email, clientApiKey)
      : clientApiKey?.trim() || undefined;

  if (provider === "openai" && !apiKey) {
    return NextResponse.json(
      { ok: false, message: "apiKey is required for the openai provider" },
      { status: 400 },
    );
  }

  let sessionId = bodySessionId;
  if (sessionId) {
    const existing = await getChatSession(supabase, sessionId);
    if (!existing || existing.draftId !== draftId) {
      return NextResponse.json({ ok: false, message: "Session not found" }, { status: 404 });
    }
  } else {
    const created = await createChatSession(supabase, { draftId, userId: user.id });
    sessionId = created.id;
  }

  const userTurn = [...messages].reverse().find((m) => m.role === "user");
  if (!userTurn) {
    return NextResponse.json({ ok: false, message: "Missing user message" }, { status: 400 });
  }

  const resolvedSessionId = sessionId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: DraftAgentStreamEvent) => {
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          // Client disconnected.
        }
      };

      let assistantContent = "";
      let assistantReasoning = "";
      const toolCalls = new Map<string, StoredToolCall>();
      let stopped = false;

      send({ type: "session", sessionId: resolvedSessionId });

      let pendingDone: Extract<DraftAgentStreamEvent, { type: "done" }> | null = null;

      try {
        for await (const event of streamDraftChatAgent({
          draftId,
          messages,
          llm: { provider, model, baseUrl, apiKey },
          signal: request.signal,
        })) {
          if (request.signal.aborted) {
            stopped = true;
            break;
          }

          if (event.type === "token") {
            assistantContent += event.delta;
          } else if (event.type === "reasoning") {
            assistantReasoning += event.delta;
          } else if (event.type === "tool_start") {
            toolCalls.set(event.id, {
              id: event.id,
              name: event.name,
              input: event.input,
              status: "running",
            });
          } else if (event.type === "tool_end") {
            const existing = toolCalls.get(event.id);
            toolCalls.set(event.id, {
              id: event.id,
              name: event.name,
              input: existing?.input ?? null,
              output: event.output,
              status: "done",
            });
          } else if (event.type === "done") {
            stopped = Boolean(event.stopped);
            pendingDone = event;
            continue;
          } else if (event.type === "error") {
            send(event);
            continue;
          }

          send(event);
        }

        if (request.signal.aborted) stopped = true;

        const finalContent =
          assistantContent.trim() ||
          (stopped ? "Stopped." : assistantReasoning.trim() ? "" : "No response from the model.");

        try {
          await appendChatTurn(supabase, resolvedSessionId, {
            userContent: userTurn.content,
            assistant: {
              content: finalContent,
              reasoning: assistantReasoning.trim() || undefined,
              toolCalls: [...toolCalls.values()],
              stopped,
            },
          });
        } catch (persistErr) {
          console.error(
            "[draft-agent] failed to persist chat turn:",
            persistErr instanceof Error ? persistErr.message : persistErr,
          );
        }

        send(pendingDone ?? { type: "done", stopped });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent failed";
        console.error("[draft-agent] route stream error:", message);
        send({ type: "error", message });
        send({ type: "done" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      // request.signal aborts the agent.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
