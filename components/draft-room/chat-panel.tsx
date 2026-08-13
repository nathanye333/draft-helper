"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_LLM_SETTINGS,
  getLlmSettingsSnapshot,
  providerDefaults,
  saveLlmSettings,
  type StoredLlmSettings,
} from "@/lib/agent/llm-settings";
import { fallbackModels } from "@/lib/agent/list-models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: unknown; output: string }[];
}

const LLM_SETTINGS_EVENT = "draft-helper-llm-settings";

function subscribeLlmSettings(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => onStoreChange();
  window.addEventListener(LLM_SETTINGS_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(LLM_SETTINGS_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function persistSettings(settings: StoredLlmSettings) {
  saveLlmSettings(settings);
  window.dispatchEvent(new Event(LLM_SETTINGS_EVENT));
}

export function ChatPanel({ draftId }: { draftId: string }) {
  const settings = useSyncExternalStore(
    subscribeLlmSettings,
    getLlmSettingsSnapshot,
    () => DEFAULT_LLM_SETTINGS,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>(() =>
    fallbackModels(settings.provider),
  );
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsSource, setModelsSource] = useState<"live" | "fallback">("fallback");
  const [hasServerOpenAiKey, setHasServerOpenAiKey] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scanSeq = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/llm/models");
        const data = (await res.json()) as { ok?: boolean; hasServerOpenAiKey?: boolean };
        if (!cancelled && res.ok && data.ok) {
          setHasServerOpenAiKey(Boolean(data.hasServerOpenAiKey));
        }
      } catch {
        if (!cancelled) setHasServerOpenAiKey(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function scanModels(opts?: { silent?: boolean }) {
    const seq = ++scanSeq.current;
    if (!opts?.silent) {
      setModelsLoading(true);
      setModelsError(null);
    }

    try {
      // Prefer browser → Ollama when provider is local (preview server can't see your laptop).
      if (settings.provider === "ollama") {
        const base = (settings.baseUrl.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");
        const res = await fetch(`${base}/api/tags`);
        if (!res.ok) {
          throw new Error(`Ollama returned ${res.status}. Is it running at ${base}?`);
        }
        const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
        const models = [
          ...new Set(
            (data.models ?? [])
              .map((m) => (m.name ?? m.model ?? "").trim())
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b)),
          ),
        ];
        if (seq !== scanSeq.current) return;
        if (models.length === 0) {
          setModelOptions(fallbackModels("ollama"));
          setModelsSource("fallback");
          setModelsError("No models found. Run: ollama pull llama3.1");
          return;
        }
        setModelOptions(models);
        setModelsSource("live");
        setModelsError(null);
        if (!models.includes(settings.model)) {
          persistSettings({ ...settings, model: models[0]! });
        }
        return;
      }

      const res = await fetch("/api/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings.provider,
          baseUrl: settings.baseUrl || undefined,
          apiKey: settings.apiKey || undefined,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        models?: string[];
        message?: string;
      };
      if (seq !== scanSeq.current) return;
      if (!res.ok || !data.ok || !data.models) {
        throw new Error(data.message ?? `Model scan failed (${res.status})`);
      }
      if (data.models.length === 0) {
        setModelOptions(fallbackModels("openai"));
        setModelsSource("fallback");
        setModelsError("No chat models returned — showing common defaults.");
        return;
      }
      setModelOptions(data.models);
      setModelsSource("live");
      setModelsError(null);
      if (!data.models.includes(settings.model)) {
        persistSettings({ ...settings, model: data.models[0]! });
      }
    } catch (err) {
      if (seq !== scanSeq.current) return;
      setModelOptions(fallbackModels(settings.provider));
      setModelsSource("fallback");
      setModelsError(err instanceof Error ? err.message : "Could not scan models");
    } finally {
      if (seq === scanSeq.current) setModelsLoading(false);
    }
  }

  useEffect(() => {
    if (!settingsOpen) return;
    const t = window.setTimeout(() => {
      void scanModels({ silent: false });
    }, 250);
    return () => window.clearTimeout(t);
    // Re-scan when provider / endpoint / key change while settings are open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional scan triggers
  }, [settingsOpen, settings.provider, settings.baseUrl, settings.apiKey]);

  const selectModels = useMemo(() => {
    if (settings.model && !modelOptions.includes(settings.model)) {
      return [settings.model, ...modelOptions];
    }
    return modelOptions;
  }, [modelOptions, settings.model]);

  const needsClientOpenAiKey =
    settings.provider === "openai" && !settings.apiKey.trim() && !hasServerOpenAiKey;

  const canSend = useMemo(() => {
    if (!input.trim() || busy) return false;
    if (!settings.model.trim()) return false;
    if (needsClientOpenAiKey) return false;
    return true;
  }, [input, busy, settings.model, needsClientOpenAiKey]);

  function updateSettings(patch: Partial<StoredLlmSettings>) {
    persistSettings({ ...settings, ...patch });
  }

  function onProviderChange(provider: StoredLlmSettings["provider"]) {
    const defaults = providerDefaults(provider);
    persistSettings({
      ...settings,
      provider,
      model: defaults.model,
      baseUrl: defaults.baseUrl,
    });
    setModelOptions(fallbackModels(provider));
    setModelsSource("fallback");
    setModelsError(null);
  }

  async function send() {
    const content = input.trim();
    if (!canSend || !content) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/drafts/${draftId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          provider: settings.provider,
          model: settings.model,
          baseUrl: settings.baseUrl || undefined,
          apiKey: settings.apiKey || undefined,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        reply?: string;
        toolCalls?: ChatMessage["toolCalls"];
        message?: string;
      };

      if (!res.ok || !data.ok || !data.reply) {
        throw new Error(data.message ?? `Request failed (${res.status})`);
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply!, toolCalls: data.toolCalls },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-xs text-slate-500">BYOK · settings stay in this browser</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setSettingsOpen((o) => !o)}
        >
          {settingsOpen ? "Hide settings" : "LLM settings"}
        </Button>
      </div>

      {settingsOpen ? (
        <div className="grid shrink-0 gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="llm-provider">Provider</Label>
            <Select
              id="llm-provider"
              value={settings.provider}
              onChange={(e) => onProviderChange(e.target.value as StoredLlmSettings["provider"])}
            >
              <option value="openai">OpenAI-compatible</option>
              <option value="ollama">Ollama (local)</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="llm-model">Model</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={
                  modelsLoading ||
                  (settings.provider === "openai" &&
                    !settings.apiKey.trim() &&
                    !hasServerOpenAiKey)
                }
                onClick={() => void scanModels()}
              >
                {modelsLoading ? "Scanning…" : "Refresh"}
              </Button>
            </div>
            <Select
              id="llm-model"
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value })}
              disabled={selectModels.length === 0}
            >
              {selectModels.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-500">
              {modelsSource === "live"
                ? `Showing ${selectModels.length} model${selectModels.length === 1 ? "" : "s"} from ${settings.provider === "ollama" ? "Ollama" : "your API"}.`
                : "Using fallback list until a live scan succeeds."}
              {modelsError ? ` ${modelsError}` : ""}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-base">Base URL</Label>
            <Input
              id="llm-base"
              value={settings.baseUrl}
              onChange={(e) => updateSettings({ baseUrl: e.target.value })}
              placeholder={
                settings.provider === "ollama"
                  ? "http://127.0.0.1:11434"
                  : "https://api.openai.com/v1"
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-key">
              API key{" "}
              {settings.provider === "ollama" || hasServerOpenAiKey ? "(optional)" : ""}
            </Label>
            <Input
              id="llm-key"
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
              placeholder={
                settings.provider === "ollama"
                  ? "Usually blank"
                  : hasServerOpenAiKey
                    ? "Leave blank to use account default"
                    : "sk-…"
              }
            />
            {settings.provider === "openai" && hasServerOpenAiKey && !settings.apiKey.trim() ? (
              <p className="text-xs text-emerald-500/90">Using your account&apos;s server default key.</p>
            ) : null}
          </div>

          {settings.provider === "ollama" ? (
            <div className="space-y-1.5 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
              <p className="font-medium text-slate-300">Connect Ollama</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Install from{" "}
                  <a
                    className="text-emerald-400 hover:underline"
                    href="https://ollama.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    ollama.com
                  </a>
                  , then start it (tray icon / <code className="text-slate-300">ollama serve</code>).
                </li>
                <li>
                  Pull a tool-capable model:{" "}
                  <code className="text-slate-300">ollama pull llama3.1</code>
                </li>
                <li>
                  Leave Base URL as <code className="text-slate-300">http://127.0.0.1:11434</code> and
                  hit Refresh — the dropdown should fill from your machine.
                </li>
                <li>
                  Run the app with <code className="text-slate-300">npm run dev</code> locally.
                  Vercel preview/production cannot reach your laptop&apos;s Ollama (chat runs on the
                  server).
                </li>
              </ol>
              <p>
                If the browser scan is blocked by CORS, set{" "}
                <code className="text-slate-300">OLLAMA_ORIGINS=*</code> and restart Ollama.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Works with OpenAI, OpenRouter, Groq, etc. Paste an API key, set Base URL if needed, then
              Refresh to load models.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ask about top available RBs by projPoints, ADP−ECR value plays, or bye-week clusters.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={m.role === "user" ? "ml-4 text-right" : "mr-4 text-left"}
            >
              <div
                className={
                  m.role === "user"
                    ? "inline-block rounded-lg bg-emerald-900/40 px-3 py-2 text-sm text-emerald-50"
                    : "inline-block rounded-lg bg-slate-800/80 px-3 py-2 text-sm text-slate-100"
                }
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
              {m.toolCalls && m.toolCalls.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.toolCalls.map((t, ti) => (
                    <Badge key={`${t.name}-${ti}`} variant="info" title={String(t.input ?? "")}>
                      {t.name}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
        {busy ? <p className="text-xs text-slate-500">Thinking…</p> : null}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="shrink-0 text-sm text-red-400">{error}</p> : null}

      <form
        className="flex shrink-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the draft agent…"
          disabled={busy}
        />
        <Button type="submit" disabled={!canSend}>
          Send
        </Button>
      </form>
    </div>
  );
}
