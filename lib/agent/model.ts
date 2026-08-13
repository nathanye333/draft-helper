import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

export type LlmProvider = "openai" | "ollama";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";

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

  if (config.provider === "ollama") {
    const baseUrl = (config.baseUrl?.trim() || DEFAULT_OLLAMA_BASE).replace(/\/$/, "");
    return new ChatOllama({
      model,
      baseUrl,
      temperature: 0.2,
    });
  }

  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error("apiKey is required for the openai provider");
  }

  const baseURL = (config.baseUrl?.trim() || DEFAULT_OPENAI_BASE).replace(/\/$/, "");
  return new ChatOpenAI({
    model,
    apiKey,
    temperature: 0.2,
    configuration: { baseURL },
  });
}
