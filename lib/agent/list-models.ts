import type { LlmProvider } from "@/lib/agent/types";

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";

export const FALLBACK_OPENAI_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1",
  "o4-mini",
];

export const FALLBACK_OLLAMA_MODELS = [
  "llama3.1",
  "llama3.2",
  "qwen2.5",
  "mistral",
  "phi4",
];

function normalizeBaseUrl(baseUrl: string | undefined, fallback: string): string {
  return (baseUrl?.trim() || fallback).replace(/\/$/, "");
}

/** Prefer chat-capable model ids when OpenAI-compatible catalogs are huge. */
function looksLikeChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.includes("embedding") || lower.includes("whisper") || lower.includes("tts")) {
    return false;
  }
  if (lower.includes("dall-e") || lower.includes("moderation") || lower.includes("realtime")) {
    return false;
  }
  return (
    lower.startsWith("gpt-") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4") ||
    lower.includes("claude") ||
    lower.includes("gemini") ||
    lower.includes("llama") ||
    lower.includes("mistral") ||
    lower.includes("qwen") ||
    lower.includes("deepseek") ||
    lower.includes("command") ||
    lower.includes("chat")
  );
}

export async function listOpenAiCompatibleModels(params: {
  baseUrl?: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const baseURL = normalizeBaseUrl(params.baseUrl, DEFAULT_OPENAI_BASE);
  const res = await fetch(`${baseURL}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.apiKey.trim()}`,
    },
    signal: params.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Model list failed (${res.status})`);
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (data.data ?? [])
    .map((m) => m.id?.trim())
    .filter((id): id is string => Boolean(id));
  const chatish = ids.filter(looksLikeChatModel);
  const chosen = (chatish.length > 0 ? chatish : ids).sort((a, b) => a.localeCompare(b));
  return [...new Set(chosen)];
}

export async function listOllamaModels(params: {
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const baseURL = normalizeBaseUrl(params.baseUrl, DEFAULT_OLLAMA_BASE);
  const res = await fetch(`${baseURL}/api/tags`, {
    method: "GET",
    signal: params.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Ollama model list failed (${res.status})`);
  }
  const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
  const names = (data.models ?? [])
    .map((m) => (m.name ?? m.model ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return [...new Set(names)];
}

export async function listAvailableModels(params: {
  provider: LlmProvider;
  baseUrl?: string;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (params.provider === "ollama") {
    return listOllamaModels({ baseUrl: params.baseUrl, signal: params.signal });
  }
  const apiKey = params.apiKey?.trim();
  if (!apiKey) {
    throw new Error("API key required to list OpenAI-compatible models");
  }
  return listOpenAiCompatibleModels({
    baseUrl: params.baseUrl,
    apiKey,
    signal: params.signal,
  });
}

export function fallbackModels(provider: LlmProvider): string[] {
  return provider === "ollama" ? FALLBACK_OLLAMA_MODELS : FALLBACK_OPENAI_MODELS;
}
