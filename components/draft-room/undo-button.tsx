"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { undoLastPick } from "@/app/actions/draft";
import { Button } from "@/components/ui/button";

export function UndoButton({ draftId, disabled }: { draftId: string; disabled?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleUndo() {
    setLoading(true);
    await undoLastPick(draftId);
    router.refresh();
    setLoading(false);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleUndo} disabled={disabled || loading}>
      {loading ? "Undoing…" : "Undo last pick"}
    </Button>
  );
}
