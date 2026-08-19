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
 * OpenAI reasoning models (gpt-5*, o-series, etc.). On /v1/chat/completions, function
 * tools are only supported when reasoning_effort is "none" — otherwise use /v1/responses.
 * Our draft agent always uses tools, so force "none" here.
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

export function reasoningForToolCallingModel(
  model: string,
): { effort: "none" } | undefined {
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
  return new ChatOpenAI({
    model,
    apiKey,
    temperature,
    streaming: true,
    ...(reasoning ? { reasoning } : {}),
    configuration: { baseURL },
  });
}
