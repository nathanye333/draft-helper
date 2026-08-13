import type { LlmProvider } from "@/lib/agent/types";

const STORAGE_KEY = "draft-helper.llm-settings";

export interface StoredLlmSettings {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export const DEFAULT_LLM_SETTINGS: StoredLlmSettings = {
  provider: "openai",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
};

/** Cached so useSyncExternalStore getSnapshot stays referentially stable. */
let cachedRaw: string | null | undefined;
let cachedSettings: StoredLlmSettings = DEFAULT_LLM_SETTINGS;

function parseSettings(raw: string | null): StoredLlmSettings {
  if (!raw) return DEFAULT_LLM_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredLlmSettings>;
    return {
      provider: parsed.provider === "ollama" ? "ollama" : "openai",
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_LLM_SETTINGS.model,
      baseUrl:
        typeof parsed.baseUrl === "string" && parsed.baseUrl
          ? parsed.baseUrl
          : parsed.provider === "ollama"
            ? "http://127.0.0.1:11434"
            : DEFAULT_LLM_SETTINGS.baseUrl,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return DEFAULT_LLM_SETTINGS;
  }
}

export function loadLlmSettings(): StoredLlmSettings {
  if (typeof window === "undefined") return DEFAULT_LLM_SETTINGS;
  return getLlmSettingsSnapshot();
}

/** Stable snapshot for useSyncExternalStore (same ref until localStorage changes). */
export function getLlmSettingsSnapshot(): StoredLlmSettings {
  if (typeof window === "undefined") return DEFAULT_LLM_SETTINGS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedSettings;
  cachedRaw = raw;
  cachedSettings = parseSettings(raw);
  return cachedSettings;
}

export function saveLlmSettings(settings: StoredLlmSettings): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(settings);
  window.localStorage.setItem(STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedSettings = settings;
}

export function providerDefaults(provider: LlmProvider): Pick<StoredLlmSettings, "model" | "baseUrl"> {
  if (provider === "ollama") {
    return { model: "llama3.1", baseUrl: "http://127.0.0.1:11434" };
  }
  return { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" };
}
