import { NextResponse } from "next/server";
import { z } from "zod";
import {
  streamDraftChatAgent,
} from "@/lib/agent/create-agent";
import type { DraftAgentStreamEvent } from "@/lib/agent/stream-types";
import { resolveOpenAiApiKey } from "@/lib/agent/server-llm";
import { fetchDraftBundle } from "@/lib/draft/data";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const chatBodySchema = z.object({
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

  const { messages, provider, model, baseUrl, apiKey: clientApiKey } = parsed.data;
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: DraftAgentStreamEvent) => {
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          // Client disconnected / controller already closed.
        }
      };

      try {
        for await (const event of streamDraftChatAgent({
          draftId,
          messages,
          llm: { provider, model, baseUrl, apiKey },
          signal: request.signal,
        })) {
          if (request.signal.aborted) break;
          send(event);
        }
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
      // Client disconnect / AbortController — request.signal aborts the agent.
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
