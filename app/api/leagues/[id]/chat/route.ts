import { NextResponse } from "next/server";
import { z } from "zod";
import { streamLeagueChatAgent } from "@/lib/agent/create-agent";
import type { DraftAgentStreamEvent } from "@/lib/agent/stream-types";
import { resolveOpenAiApiKey } from "@/lib/agent/server-llm";
import { fetchLeagueBundle } from "@/lib/league/data";
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
  workingLineup: z
    .array(
      z.object({
        espnPlayerId: z.number().int(),
        name: z.string(),
        position: z.string(),
        nflTeam: z.string().nullable().optional(),
        slot: z.string(),
        weekProj: z.number().nullable(),
        injuryStatus: z.string().nullable().optional(),
      }),
    )
    .max(40)
    .optional(),
});

function encodeEvent(event: DraftAgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

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
  const parsed = chatBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { messages, provider, model, baseUrl, apiKey: clientApiKey, workingLineup } = parsed.data;
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
          // disconnected
        }
      };

      try {
        for await (const event of streamLeagueChatAgent({
          leagueId,
          messages,
          llm: { provider, model, baseUrl, apiKey },
          signal: request.signal,
          workingLineup: workingLineup
            ? workingLineup.map((p) => ({
                espnPlayerId: p.espnPlayerId,
                name: p.name,
                position: p.position,
                nflTeam: p.nflTeam ?? null,
                slot: p.slot,
                weekProj: p.weekProj,
                injuryStatus: p.injuryStatus ?? null,
              }))
            : null,
        })) {
          if (request.signal.aborted) break;
          send(event);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent failed";
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
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
