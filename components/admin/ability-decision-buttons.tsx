"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { decideAbilityStatus } from "@/app/admin/actions";

export function AbilityDecisionButtons({ abilityId }: { abilityId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await decideAbilityStatus({ abilityId, decision: "approved" });
          });
        }}
      >
        Approve
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await decideAbilityStatus({ abilityId, decision: "rejected" });
          });
        }}
      >
        Reject
      </Button>
    </div>
  );
}
