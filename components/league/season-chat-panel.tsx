"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_LLM_SETTINGS,
  getLlmSettingsSnapshot,
  providerDefaults,
  saveLlmSettings,
  type StoredLlmSettings,
} from "@/lib/agent/llm-settings";
import type { DraftAgentStreamEvent } from "@/lib/agent/stream-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
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

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function SeasonChatPanel({ leagueId }: { leagueId: string }) {
  const settings = useSyncExternalStore(
    subscribeLlmSettings,
    getLlmSettingsSnapshot,
    () => DEFAULT_LLM_SETTINGS,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hasServerOpenAiKey, setHasServerOpenAiKey] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/llm/models");
        const data = (await res.json()) as { ok?: boolean; hasServerOpenAiKey?: boolean };
        if (!cancelled && data.ok) {
          setHasServerOpenAiKey(Boolean(data.hasServerOpenAiKey));
        }
      } catch {
        // ignore — send still works if server key resolves on the chat route
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const needsClientOpenAiKey =
    settings.provider === "openai" && !settings.apiKey.trim() && !hasServerOpenAiKey;

  const canSend = useMemo(() => {
    if (!input.trim() || busy) return false;
    if (!(settings.model.trim() || providerDefaults(settings.provider).model)) return false;
    if (needsClientOpenAiKey) return false;
    return true;
  }, [input, busy, settings.model, settings.provider, needsClientOpenAiKey]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !canSend) return;
    setError(null);
    setInput("");
    const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
    const assistantId = newId();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "", streaming: true }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/leagues/${leagueId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          provider: settings.provider,
          model: settings.model || providerDefaults(settings.provider).model,
          baseUrl: settings.baseUrl || undefined,
          // Empty string → omit so server can use allowlisted OPENAI_API_KEY
          apiKey: settings.apiKey.trim() || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Chat failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as DraftAgentStreamEvent;
          if (event.type === "token") {
            assistantContent += event.delta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: assistantContent, streaming: true } : m,
              ),
            );
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: assistantContent.trim() || "No response.", streaming: false }
            : m,
        ),
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || "Stopped.", streaming: false }
              : m,
          ),
        );
      } else {
        setError(err instanceof Error ? err.message : "Chat failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <div>
          <p className="text-sm font-medium text-slate-100">Season agent</p>
          <p className="truncate text-[11px] text-slate-500">
            {settings.model || providerDefaults(settings.provider).model}
            {settings.provider === "openai" && hasServerOpenAiKey && !settings.apiKey.trim()
              ? " · account key"
              : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowSettings((s) => !s)}>
          LLM
        </Button>
      </div>

      {showSettings ? (
        <div className="space-y-2 border-b border-slate-800 p-3 text-sm">
          <div>
            <Label>Provider</Label>
            <Select
              value={settings.provider}
              onChange={(e) => {
                const provider = e.target.value as StoredLlmSettings["provider"];
                persistSettings({ ...settings, provider, ...providerDefaults(provider) });
              }}
            >
              <option value="openai">OpenAI-compatible</option>
              <option value="ollama">Ollama</option>
            </Select>
          </div>
          <div>
            <Label>Model</Label>
            <Input
              value={settings.model}
              onChange={(e) => persistSettings({ ...settings, model: e.target.value })}
            />
          </div>
          {settings.provider === "openai" ? (
            <div>
              <Label>
                API key {hasServerOpenAiKey ? "(optional — account default available)" : ""}
              </Label>
              <Input
                type="password"
                value={settings.apiKey}
                placeholder={
                  hasServerOpenAiKey ? "Leave blank to use account key" : "sk-…"
                }
                onChange={(e) => persistSettings({ ...settings, apiKey: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ask for a start/sit, trade eval, or waiver targets.
          </p>
        ) : null}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-8 rounded-lg bg-slate-800 px-3 py-2 text-sm"
                : "mr-4 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm whitespace-pre-wrap"
            }
          >
            {m.content}
            {m.streaming ? (
              <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="px-3 text-xs text-red-400">{error}</p> : null}
      {needsClientOpenAiKey ? (
        <p className="px-3 text-xs text-amber-400">Add an OpenAI API key in LLM settings to chat.</p>
      ) : null}

      <div className="flex gap-2 border-t border-slate-800 p-3">
        <Input
          value={input}
          placeholder="Ask the season agent…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy}
        />
        {busy ? (
          <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button type="button" onClick={() => void send()} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
