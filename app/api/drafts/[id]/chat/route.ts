import { NextResponse } from "next/server";
import { z } from "zod";
import { runDraftChatAgent } from "@/lib/agent/create-agent";
import { resolveOpenAiApiKey } from "@/lib/agent/server-llm";
import { fetchDraftBundle } from "@/lib/draft/data";
import { createClient } from "@/lib/supabase/server";

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

  try {
    const result = await runDraftChatAgent({
      draftId,
      messages,
      llm: { provider, model, baseUrl, apiKey },
    });

    return NextResponse.json({
      ok: true,
      reply: result.reply,
      toolCalls: result.toolCalls,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agent failed";
    return NextResponse.json({ ok: false, message }, { status: 502 });
  }
}
