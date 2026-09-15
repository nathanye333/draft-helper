"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { forceSeasonSkillSleep, type ForceSleepState } from "@/app/admin/actions";

export function ForceSleepButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ForceSleepState | null>(null);

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const next = await forceSeasonSkillSleep();
            setState(next);
          });
        }}
      >
        {pending ? "Running sleep…" : "Force sleep"}
      </Button>
      {state ? (
        <pre className="max-h-48 overflow-auto rounded-md border border-slate-800 bg-slate-950/80 p-3 text-[11px] text-slate-300">
          {JSON.stringify(state, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
