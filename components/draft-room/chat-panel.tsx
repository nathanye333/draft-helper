"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_LLM_SETTINGS,
  loadLlmSettings,
  providerDefaults,
  saveLlmSettings,
  type StoredLlmSettings,
} from "@/lib/agent/llm-settings";
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

function getLlmSettingsSnapshot(): StoredLlmSettings {
  return loadLlmSettings();
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const canSend = useMemo(() => {
    if (!input.trim() || busy) return false;
    if (!settings.model.trim()) return false;
    if (settings.provider === "openai" && !settings.apiKey.trim()) return false;
    return true;
  }, [input, busy, settings]);

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          BYOK draft analyst · settings stay in this browser
        </p>
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
        <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 sm:grid-cols-2">
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
            <Label htmlFor="llm-model">Model</Label>
            <Input
              id="llm-model"
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value })}
              placeholder={settings.provider === "ollama" ? "llama3.1" : "gpt-4o-mini"}
            />
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
              API key {settings.provider === "ollama" ? "(optional)" : ""}
            </Label>
            <Input
              id="llm-key"
              type="password"
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
              placeholder={settings.provider === "ollama" ? "Usually blank" : "sk-…"}
            />
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Ollama only works when this Next.js server can reach your machine (local{" "}
            <code className="text-slate-400">next dev</code>). Use a tool-calling model such as
            llama3.1.
          </p>
        </div>
      ) : null}

      <div className="flex max-h-80 min-h-40 flex-col gap-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ask about top available RBs by projPoints, ADP−ECR value plays, or bye-week clusters.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={m.role === "user" ? "ml-6 text-right" : "mr-6 text-left"}
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

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <form
        className="flex gap-2"
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
