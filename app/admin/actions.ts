"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/admin/allowlist";
import { runSeasonSkillSleep } from "@/lib/agent/skill-sleep";

export type ForceSleepState = {
  ok: boolean;
  error?: string;
  result?: unknown;
};

export type AbilityDecisionState = {
  ok: boolean;
  error?: string;
};

async function requireAdminEmail(): Promise<string> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  if (!isAdminEmail(userData.user.email)) {
    throw new Error("Forbidden");
  }
  return userData.user.email!.trim().toLowerCase();
}

export async function forceSeasonSkillSleep(): Promise<ForceSleepState> {
  try {
    await requireAdminEmail();
  } catch {
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

export async function decideAbilityStatus(params: {
  abilityId: string;
  decision: "approved" | "rejected";
}): Promise<AbilityDecisionState> {
  let email: string;
  try {
    email = await requireAdminEmail();
  } catch {
    return { ok: false, error: "Forbidden" };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("agent_abilities")
    .select("id, ability_kind, status")
    .eq("id", params.abilityId)
    .maybeSingle();

  if (!row) return { ok: false, error: "Ability not found" };
  if (row.status !== "proposed") {
    return { ok: false, error: `Cannot decide status=${row.status}` };
  }
  if (row.ability_kind === "workflow") {
    return {
      ok: false,
      error: "Workflow abilities are auto-accepted by sleep; no manual approve",
    };
  }

  const { error } = await admin
    .from("agent_abilities")
    .update({
      status: params.decision,
      decided_at: new Date().toISOString(),
      decided_by: email,
    })
    .eq("id", params.abilityId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}
