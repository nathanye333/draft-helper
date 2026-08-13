import { NextResponse } from "next/server";
import { z } from "zod";
import { listAvailableModels } from "@/lib/agent/list-models";
import {
  hasServerOpenAiDefaultConfigured,
  resolveOpenAiApiKey,
} from "@/lib/agent/server-llm";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  provider: z.enum(["openai", "ollama"]),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    hasServerOpenAiKey: hasServerOpenAiDefaultConfigured(user.email),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { provider, baseUrl, apiKey: clientApiKey } = parsed.data;
  const apiKey =
    provider === "openai"
      ? resolveOpenAiApiKey(user.email, clientApiKey)
      : clientApiKey?.trim() || undefined;

  try {
    const models = await listAvailableModels({ provider, baseUrl, apiKey });
    return NextResponse.json({
      ok: true,
      models,
      usedServerOpenAiKey: provider === "openai" && !clientApiKey?.trim() && Boolean(apiKey),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list models";
    return NextResponse.json({ ok: false, message, models: [] }, { status: 502 });
  }
}
