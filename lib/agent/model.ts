import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LlmConfig } from "@/lib/agent/types";

export type { LlmConfig, LlmProvider } from "@/lib/agent/types";

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";

/**
 * Some OpenAI models (o-series / certain gpt-5) only accept the default temperature of 1
 * and reject 0.2. Others work fine with a lower sampling temperature.
 */
export function temperatureForModel(model: string): number {
  const m = model.trim().toLowerCase();
  if (isReasoningCapableModel(m)) return 1;
  return 0.2;
}

/**
 * OpenAI reasoning models (gpt-5*, o-series, etc.).
 */
export function isReasoningCapableModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (/^o[1-9]([-.]|$)/.test(m) || m.includes("o1-") || m.includes("o3-") || m.includes("o4-")) {
    return true;
  }
  if (m.startsWith("gpt-5") && !m.startsWith("gpt-5-chat")) return true;
  if (m.includes("reasoner")) return true;
  return false;
}

/** gpt-5.6 family (sol / luna / terra) — tools require Responses API unless effort is none. */
export function isGpt56Family(model: string): boolean {
  return model.trim().toLowerCase().includes("gpt-5.6");
}

/**
 * Only force reasoning_effort=none for legacy reasoning models that still use
 * Chat Completions with tools. gpt-5.6* must NOT get this — it breaks other
 * models and causes empty `content: []` payloads on tool-only turns for luna.
 * gpt-5.6 goes through Responses API instead.
 */
export function reasoningForToolCallingModel(
  model: string,
): { effort: "none" } | undefined {
  if (isGpt56Family(model)) return undefined;
  return isReasoningCapableModel(model) ? { effort: "none" } : undefined;
}

/**
 * Build a chat model from BYOK request config.
 * - openai: OpenAI-compatible API (OpenAI, OpenRouter, Groq, Ollama /v1, etc.)
 * - ollama: native ChatOllama client (default http://127.0.0.1:11434)
 */
export function createChatModel(config: LlmConfig): BaseChatModel {
  const model = config.model.trim();
  if (!model) {
    throw new Error("model is required");
  }

  const temperature = temperatureForModel(model);

  if (config.provider === "ollama") {
    const baseUrl = (config.baseUrl?.trim() || DEFAULT_OLLAMA_BASE).replace(/\/$/, "");
    return new ChatOllama({
      model,
      baseUrl,
      temperature,
    });
  }

  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error("apiKey is required for the openai provider");
  }

  const baseURL = (config.baseUrl?.trim() || DEFAULT_OPENAI_BASE).replace(/\/$/, "");
  const reasoning = reasoningForToolCallingModel(model);

  // gpt-5.6 + function tools must use /v1/responses. Chat Completions rejects
  // tools with default reasoning, and forcing effort=none produces empty
  // content arrays on tool-only assistant turns.
  if (isGpt56Family(model)) {
    return new ChatOpenAI({
      model,
      apiKey,
      temperature,
      streaming: true,
      useResponsesApi: true,
      configuration: { baseURL },
    });
  }

  return new ChatOpenAI({
    model,
    apiKey,
    temperature,
    streaming: true,
    ...(reasoning ? { reasoning } : {}),
    configuration: { baseURL },
  });
}
