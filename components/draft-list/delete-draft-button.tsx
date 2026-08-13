"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteDraft } from "@/app/actions/draft";
import { Button } from "@/components/ui/button";

export function DeleteDraftButton({
  draftId,
  draftName,
}: {
  draftId: string;
  draftName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const ok = window.confirm(`Delete “${draftName}”? This cannot be undone.`);
    if (!ok) return;

    setBusy(true);
    try {
      await deleteDraft(draftId);
      router.refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete draft");
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      disabled={busy}
      onClick={onDelete}
      aria-label={`Delete ${draftName}`}
    >
      {busy ? "Deleting…" : "Delete"}
    </Button>
  );
}
