import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";

export const SEASON_SKILL_KIND = "season" as const;

export interface ActiveSeasonSkill {
  version: number;
  content: string;
  status: "active" | "seed";
}

const SEED_PATH = join(process.cwd(), "skills", "season-agent.md");

let cached: { skill: ActiveSeasonSkill; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

function readSeedFile(): string {
  try {
    return readFileSync(SEED_PATH, "utf8").trim();
  } catch {
    return [
      "You are a fantasy football season advisor for this user's ESPN-synced league.",
      "Use tools; do not invent numbers. Be decisive; do not ask follow-up questions.",
    ].join(" ");
  }
}

/** Ensure an active season skill row exists (seed from skills/season-agent.md). */
export async function ensureActiveSeasonSkill(): Promise<ActiveSeasonSkill> {
  const admin = createAdminClient();
  const { data: active } = await admin
    .from("agent_skills")
    .select("version, content, status")
    .eq("kind", SEASON_SKILL_KIND)
    .eq("status", "active")
    .maybeSingle();

  if (active?.content) {
    return {
      version: Number(active.version),
      content: String(active.content),
      status: "active",
    };
  }

  const seed = readSeedFile();
  const { data: inserted, error } = await admin
    .from("agent_skills")
    .upsert(
      {
        kind: SEASON_SKILL_KIND,
        version: 1,
        content: seed,
        status: "active",
        metrics_json: { source: "seed_file" },
      },
      { onConflict: "kind,version" },
    )
    .select("version, content")
    .single();

  if (error || !inserted) {
    return { version: 1, content: seed, status: "seed" };
  }

  // Demote any other active rows (shouldn't happen with partial unique index).
  await admin
    .from("agent_skills")
    .update({ status: "rejected" })
    .eq("kind", SEASON_SKILL_KIND)
    .eq("status", "active")
    .neq("version", inserted.version);

  await admin
    .from("agent_skills")
    .update({ status: "active" })
    .eq("kind", SEASON_SKILL_KIND)
    .eq("version", inserted.version);

  return {
    version: Number(inserted.version),
    content: String(inserted.content),
    status: "active",
  };
}

export async function getActiveSeasonSkill(): Promise<ActiveSeasonSkill> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.skill;
  }
  const skill = await ensureActiveSeasonSkill();
  cached = { skill, loadedAt: Date.now() };
  return skill;
}

export function invalidateSeasonSkillCache() {
  cached = null;
}

/** Render skill markdown with runtime placeholders. */
export function renderSeasonSkill(
  content: string,
  params: { leagueId: string; workingLineupBlock?: string },
): string {
  let out = content.replaceAll("{{leagueId}}", params.leagueId);
  if (params.workingLineupBlock) {
    out = `${out.trim()}\n\n${params.workingLineupBlock}`;
  }
  return out.trim();
}

export async function getNextSeasonSkillVersion(): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("agent_skills")
    .select("version")
    .eq("kind", SEASON_SKILL_KIND)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.version != null ? Number(data.version) + 1 : 1;
}
