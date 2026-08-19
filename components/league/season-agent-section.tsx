"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { ClientIslandErrorBoundary } from "@/components/draft-room/client-island-error-boundary";

const SeasonChatPanel = dynamic(
  () => import("@/components/league/season-chat-panel").then((m) => m.SeasonChatPanel),
  {
    ssr: false,
    loading: () => <p className="px-1 text-sm text-slate-500">Loading season agent…</p>,
  },
);

export function SeasonAgentSection({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false);
  const [mountedChat, setMountedChat] = useState(false);
  const [seedPrompt, setSeedPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (open) setMountedChat(true);
  }, [open]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ leagueId: string; prompt: string }>).detail;
      if (!detail || detail.leagueId !== leagueId) return;
      setSeedPrompt(detail.prompt);
      setOpen(true);
    };
    window.addEventListener("season-agent-prompt", handler);
    return () => window.removeEventListener("season-agent-prompt", handler);
  }, [leagueId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex h-11 items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 text-sm font-medium text-slate-100 shadow-lg shadow-black/40 transition hover:border-slate-500 hover:bg-slate-800"
        >
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Season agent
        </button>
      ) : null}

      {open ? (
        <button
          type="button"
          aria-label="Close season agent backdrop"
          className="fixed inset-0 z-40 bg-black/40 md:bg-transparent"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={
          open
            ? "fixed inset-y-0 right-0 z-50 flex w-full max-w-lg translate-x-0 flex-col border-l border-slate-800 bg-slate-950 shadow-2xl shadow-black/50 transition-transform duration-200 ease-out"
            : "pointer-events-none fixed inset-y-0 right-0 z-50 flex w-full max-w-lg translate-x-full flex-col border-l border-slate-800 bg-slate-950 shadow-2xl shadow-black/50 transition-transform duration-200 ease-out"
        }
        aria-hidden={!open}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Season agent</h2>
            <p className="text-xs text-slate-500">Lineup, trades, waivers</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          {mountedChat ? (
            <ClientIslandErrorBoundary name="Season agent">
              <SeasonChatPanel leagueId={leagueId} seedPrompt={seedPrompt} onSeedPromptConsumed={() => setSeedPrompt(null)} />
            </ClientIslandErrorBoundary>
          ) : null}
        </div>
      </aside>
    </>
  );
}
