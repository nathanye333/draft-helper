"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteLeague } from "@/app/actions/league";
import { Button } from "@/components/ui/button";

export function DeleteLeagueButton({
  leagueId,
  leagueName,
}: {
  leagueId: string;
  leagueName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete league “${leagueName}”?`)) return;
        startTransition(async () => {
          await deleteLeague(leagueId);
          router.push("/leagues");
        });
      }}
    >
      Delete
    </Button>
  );
}
