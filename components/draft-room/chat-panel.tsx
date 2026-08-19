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
import type { DraftAgentStreamEvent } from "@/lib/agent/stream-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface ToolCallVM {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  status: "running" | "done";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallVM[];
  streaming?: boolean;
  stopped?: boolean;
}

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface StoredMessagePayload {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string | null;
  toolCalls?: ToolCallVM[] | null;
  stopped?: boolean;
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

function formatSessionWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function storedToChatMessage(m: StoredMessagePayload): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    reasoning: m.reasoning ?? undefined,
    toolCalls: m.toolCalls ?? undefined,
    stopped: m.stopped,
  };
}

function ThinkingBlock({
  text,
  streaming,
}: {
  text: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (!text && !streaming) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-slate-800/80 bg-slate-900/40">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs text-slate-400 hover:bg-slate-800/40"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-medium text-slate-300">
          {streaming && !text ? "Thinking…" : "Thoughts"}
          {streaming ? (
            <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" />
          ) : null}
        </span>
        <span className="text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <div className="border-t border-slate-800/80 px-2.5 py-2 text-xs leading-relaxed whitespace-pre-wrap text-slate-500 italic">
          {text || (streaming ? "…" : "")}
        </div>
      ) : null}
    </div>
  );
}

function ToolCallRows({ tools }: { tools: ToolCallVM[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="mb-2 space-y-1.5">
      {tools.map((t) => (
        <details
          key={t.id}
          className="rounded-md border border-slate-800/80 bg-slate-900/30 text-xs open:bg-slate-900/50"
        >
          <summary className="cursor-pointer list-none px-2.5 py-1.5 text-slate-300 marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="mr-2 inline-flex items-center gap-1.5">
              <span
                className={
                  t.status === "running"
                    ? "inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"
                    : "inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                }
              />
              <span className="font-mono text-[11px] text-slate-200">{t.name}</span>
            </span>
            <span className="text-slate-500">
              {t.status === "running" ? "running…" : "done"}
            </span>
          </summary>
          <div className="space-y-2 border-t border-slate-800/80 px-2.5 py-2 text-[11px] text-slate-400">
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/60 p-2">
              {(() => {
                try {
                  return JSON.stringify(t.input, null, 2) ?? "null";
                } catch {
                  return String(t.input);
                }
              })()}
            </pre>
            {t.output ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/60 p-2 text-slate-300">
                {t.output}
              </pre>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

export function ChatPanel({ draftId }: { draftId: string }) {
  const settings = useSyncExternalStore(
    subscribeLlmSettings,
    getLlmSettingsSnapshot,
    () => DEFAULT_LLM_SETTINGS,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!sessionsOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!sessionsMenuRef.current?.contains(e.target as Node)) {
        setSessionsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [sessionsOpen]);

  async function refreshSessionsList() {
    try {
      const res = await fetch(`/api/drafts/${draftId}/chat/sessions`);
      const data = (await res.json()) as {
        ok?: boolean;
        sessions?: SessionSummary[];
      };
      if (res.ok && data.ok && data.sessions) {
        setSessions(data.sessions);
      }
    } catch {
      // keep existing list
    }
  }

  async function refreshSessions(preferSessionId?: string | null) {
    setSessionsLoading(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}/chat/sessions`);
      const data = (await res.json()) as {
        ok?: boolean;
        sessions?: SessionSummary[];
      };
      if (!res.ok || !data.ok || !data.sessions) {
        throw new Error("Failed to load chat sessions");
      }
      setSessions(data.sessions);

      const targetId =
        preferSessionId ??
        activeSessionId ??
        (data.sessions.length > 0 ? data.sessions[0]!.id : null);

      if (targetId && targetId !== activeSessionId) {
        await loadSession(targetId, data.sessions);
      } else if (!targetId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }

  async function loadSession(sessionId: string, knownSessions?: SessionSummary[]) {
    const res = await fetch(`/api/drafts/${draftId}/chat/sessions/${sessionId}`);
    const data = (await res.json()) as {
      ok?: boolean;
      session?: {
        id: string;
        title: string;
        updatedAt: string;
        messageCount: number;
        messages: StoredMessagePayload[];
      };
    };
    if (!res.ok || !data.ok || !data.session) {
      throw new Error("Failed to load chat session");
    }

    setActiveSessionId(data.session.id);
    setMessages(data.session.messages.map(storedToChatMessage));
    setError(null);
    setSessionsOpen(false);

    const summary: SessionSummary = {
      id: data.session.id,
      title: data.session.title,
      updatedAt: data.session.updatedAt,
      messageCount: data.session.messageCount,
    };
    setSessions((prev) => {
      const base = knownSessions ?? prev;
      const without = base.filter((s) => s.id !== summary.id);
      return [summary, ...without];
    });
  }

  async function startNewChat() {
    if (busy) return;
    const res = await fetch(`/api/drafts/${draftId}/chat/sessions`, { method: "POST" });
    const data = (await res.json()) as {
      ok?: boolean;
      session?: SessionSummary;
    };
    if (!res.ok || !data.ok || !data.session) {
      setError("Could not start a new chat");
      return;
    }
    setActiveSessionId(data.session.id);
    setMessages([]);
    setError(null);
    setSessionsOpen(false);
    setSessions((prev) => [data.session!, ...prev.filter((s) => s.id !== data.session!.id)]);
    textareaRef.current?.focus();
  }

  useEffect(() => {
    void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per draft
  }, [draftId]);

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
        setModelOptions(fallbackModels(settings.provider));
        setModelsSource("fallback");
        setModelsError(
          settings.provider === "ollama"
            ? "No models found. Run: ollama pull llama3.1"
            : "No chat models returned — showing common defaults.",
        );
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

  function stop() {
    abortRef.current?.abort();
  }

  function patchAssistant(
    assistantId: string,
    patch: (msg: ChatMessage) => ChatMessage,
  ) {
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? patch(m) : m)));
  }

  async function send() {
    const content = input.trim();
    if (!canSend || !content) return;

    const userMsg: ChatMessage = { id: newId(), role: "user", content };
    const assistantId = newId();
    const historyForApi = [...messages, userMsg]
      .filter((m) => m.role === "user" || m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        reasoning: "",
        toolCalls: [],
        streaming: true,
      },
    ]);
    setInput("");
    setBusy(true);
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(`/api/drafts/${draftId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          messages: historyForApi,
          sessionId: activeSessionId ?? undefined,
          provider: settings.provider,
          model: settings.model,
          baseUrl: settings.baseUrl || undefined,
          apiKey: settings.apiKey || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: DraftAgentStreamEvent;
          try {
            event = JSON.parse(trimmed) as DraftAgentStreamEvent;
          } catch {
            continue;
          }

          if (event.type === "session") {
            setActiveSessionId(event.sessionId);
          } else if (event.type === "reasoning") {
            const delta = event.delta;
            patchAssistant(assistantId, (m) => ({
              ...m,
              reasoning: `${m.reasoning ?? ""}${delta}`,
            }));
          } else if (event.type === "token") {
            const delta = event.delta;
            patchAssistant(assistantId, (m) => ({
              ...m,
              content: `${m.content}${delta}`,
            }));
          } else if (event.type === "tool_start") {
            const start = event;
            patchAssistant(assistantId, (m) => ({
              ...m,
              toolCalls: [
                ...(m.toolCalls ?? []),
                {
                  id: start.id,
                  name: start.name,
                  input: start.input,
                  status: "running",
                },
              ],
            }));
          } else if (event.type === "tool_end") {
            const end = event;
            patchAssistant(assistantId, (m) => ({
              ...m,
              toolCalls: (m.toolCalls ?? []).map((t) =>
                t.id === end.id
                  ? { ...t, output: end.output, status: "done" as const }
                  : t,
              ),
            }));
          } else if (event.type === "error") {
            const message = event.message || "Agent failed";
            setError(message);
            patchAssistant(assistantId, (m) => ({
              ...m,
              content: m.content.trim() || message,
            }));
          } else if (event.type === "done") {
            const stopped = Boolean(event.stopped);
            patchAssistant(assistantId, (m) => ({
              ...m,
              streaming: false,
              stopped,
              content:
                m.content.trim() ||
                (stopped ? "Stopped." : m.reasoning ? "" : "No response from the model."),
            }));
          }
        }
      }

      // Flush a final NDJSON line if the stream ended without a trailing newline.
      const trailing = buffer.trim();
      if (trailing) {
        try {
          const event = JSON.parse(trailing) as DraftAgentStreamEvent;
          if (event.type === "error") {
            setError(event.message || "Agent failed");
            patchAssistant(assistantId, (m) => ({
              ...m,
              streaming: false,
              content: m.content.trim() || event.message || "Agent failed",
            }));
          } else if (event.type === "done") {
            patchAssistant(assistantId, (m) => ({
              ...m,
              streaming: false,
              stopped: Boolean(event.stopped),
              content:
                m.content.trim() ||
                (event.stopped ? "Stopped." : "No response from the model."),
            }));
          } else if (event.type === "token") {
            patchAssistant(assistantId, (m) => ({
              ...m,
              content: `${m.content}${event.delta}`,
            }));
          }
        } catch {
          // ignore partial trailing junk
        }
      }

      patchAssistant(assistantId, (m) =>
        m.streaming
          ? {
              ...m,
              streaming: false,
              stopped: ac.signal.aborted,
              content:
                m.content.trim() ||
                (ac.signal.aborted ? "Stopped." : "No response from the model."),
            }
          : m,
      );
    } catch (err) {
      if (ac.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        patchAssistant(assistantId, (m) => ({
          ...m,
          streaming: false,
          stopped: true,
          content: m.content.trim() || "Stopped.",
        }));
      } else {
        const message = err instanceof Error ? err.message : "Chat failed";
        setError(message);
        patchAssistant(assistantId, (m) => ({
          ...m,
          streaming: false,
          content: m.content.trim() || message,
        }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      void refreshSessionsList();
      textareaRef.current?.focus();
    }
  }

  const activeSessionTitle =
    sessions.find((s) => s.id === activeSessionId)?.title ?? "Chat";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-slate-800/80 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="relative min-w-0 flex-1" ref={sessionsMenuRef}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 max-w-full justify-start truncate px-2 font-normal text-slate-200"
              disabled={busy || sessionsLoading}
              onClick={() => setSessionsOpen((o) => !o)}
            >
              {sessionsLoading ? "Loading chats…" : activeSessionTitle}
            </Button>
            {sessionsOpen ? (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
                {sessions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-500">No previous chats</p>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy}
                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-slate-800/80 disabled:opacity-50 ${
                        s.id === activeSessionId ? "bg-slate-800/60 text-emerald-300" : "text-slate-200"
                      }`}
                      onClick={() => {
                        if (s.id === activeSessionId) {
                          setSessionsOpen(false);
                          return;
                        }
                        void loadSession(s.id).catch(() => setError("Could not load chat"));
                      }}
                    >
                      <span className="line-clamp-1 w-full font-medium">{s.title}</span>
                      <span className="text-[10px] text-slate-500">
                        {formatSessionWhen(s.updatedAt)}
                        {s.messageCount > 0 ? ` · ${s.messageCount} msgs` : ""}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void startNewChat()}
            >
              New chat
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              {settingsOpen ? "Hide" : "Settings"}
            </Button>
          </div>
        </div>
        <p className="truncate text-[11px] text-slate-500">
          {settings.model}
          {settings.provider === "openai" && hasServerOpenAiKey && !settings.apiKey.trim()
            ? " · account key"
            : ""}
        </p>
      </div>

      {settingsOpen ? (
        <div className="mt-2 max-h-[42%] shrink-0 space-y-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/50 p-3">
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
                ? `Showing ${selectModels.length} models.`
                : "Fallback list until scan succeeds."}
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
          </div>

          {settings.provider === "ollama" ? (
            <p className="text-xs text-slate-500">
              Ollama chat runs on the app server — use local{" "}
              <code className="text-slate-300">npm run dev</code> or paste a reachable HTTPS base
              URL (e.g. Cloudflare tunnel with{" "}
              <code className="text-slate-300">--http-host-header=&quot;localhost:11434&quot;</code>
              ).
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-0.5 py-1">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-2 px-1 text-sm text-slate-500">
            <p className="font-medium text-slate-300">Draft agent</p>
            <p>Ask about available RBs, ADP value, bye clusters, or roster needs.</p>
            <p className="text-xs">
              Use <span className="text-slate-400">New chat</span> for a fresh thread, or open a
              previous chat from the menu above.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="px-0.5">
              {m.role === "user" ? (
                <div className="ml-6 rounded-2xl bg-slate-800/70 px-3 py-2 text-sm text-slate-100">
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ) : (
                <div className="mr-2 text-sm text-slate-100">
                  <ThinkingBlock
                    text={m.reasoning ?? ""}
                    streaming={Boolean(m.streaming && !(m.content || "").trim())}
                  />
                  <ToolCallRows tools={m.toolCalls ?? []} />
                  {m.content ? (
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {m.content}
                      {m.streaming ? (
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-emerald-400 align-middle" />
                      ) : null}
                    </p>
                  ) : m.streaming ? (
                    <p className="text-xs text-slate-500">
                      Generating
                      <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-emerald-400 align-middle" />
                    </p>
                  ) : null}
                  {m.stopped ? (
                    <p className="mt-1 text-[11px] text-slate-500">Stopped</p>
                  ) : null}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="shrink-0 pt-1 text-sm text-red-400">{error}</p> : null}

      <form
        className="mt-2 shrink-0 rounded-xl border border-slate-700 bg-slate-900/80 p-2 shadow-inner shadow-black/20"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) stop();
          else void send();
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy && canSend) void send();
            }
          }}
          placeholder="Ask the draft agent…"
          disabled={false}
          className="max-h-40 min-h-[52px] w-full resize-none bg-transparent px-1.5 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-[10px] text-slate-600">Enter send · Shift+Enter newline</p>
          {busy ? (
            <Button type="button" variant="secondary" size="sm" onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!canSend}>
              Send
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
