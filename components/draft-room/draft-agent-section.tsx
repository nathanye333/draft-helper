"use client";

import dynamic from "next/dynamic";

const ChatPanel = dynamic(
  () => import("@/components/draft-room/chat-panel").then((m) => m.ChatPanel),
  {
    ssr: false,
    loading: () => <p className="text-sm text-slate-500">Loading draft agent…</p>,
  },
);

export function DraftAgentSection({ draftId }: { draftId: string }) {
  return <ChatPanel draftId={draftId} />;
}
