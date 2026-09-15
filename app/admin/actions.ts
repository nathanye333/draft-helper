"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin/allowlist";
import { runSeasonSkillSleep } from "@/lib/agent/skill-sleep";

export type ForceSleepState = {
  ok: boolean;
  error?: string;
  result?: unknown;
};

export async function forceSeasonSkillSleep(): Promise<ForceSleepState> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  if (!isAdminEmail(userData.user.email)) {
    return { ok: false, error: "Forbidden" };
  }

  try {
    const result = await runSeasonSkillSleep({ force: true });
    revalidatePath("/admin");
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Skill sleep failed",
    };
  }
}
