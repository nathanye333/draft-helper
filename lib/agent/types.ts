export type LlmProvider = "openai" | "ollama";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}
