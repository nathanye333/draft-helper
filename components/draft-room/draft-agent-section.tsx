"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { ClientIslandErrorBoundary } from "@/components/draft-room/client-island-error-boundary";

const ChatPanel = dynamic(
  () => import("@/components/draft-room/chat-panel").then((m) => m.ChatPanel),
  {
    ssr: false,
    loading: () => <p className="text-sm text-slate-500">Loading draft agent…</p>,
  },
);

/**
 * Draft agent is opt-in: the chat chunk only loads after the user opens it,
 * so a bad agent bundle cannot blank the live draft room on first paint.
 */
export function DraftAgentSection({ draftId }: { draftId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Ask about remaining players, ADP value, and roster needs. Uses your own API key or local
          Ollama — nothing is stored on the server.
        </p>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Open draft agent
        </Button>
      </div>
    );
  }

  return (
    <ClientIslandErrorBoundary name="Draft agent">
      <ChatPanel draftId={draftId} />
    </ClientIslandErrorBoundary>
  );
}
