"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  connectEspnLeague,
  syncEspnLeague,
  updateEspnCredentials,
} from "@/lib/espn/sync";
import { fetchEspnTeamsPreview } from "@/lib/espn/client";
import { syncProjectionsForSeason } from "@/lib/fantasypros/projections-sync";
import { createClient } from "@/lib/supabase/server";

const connectSchema = z.object({
  espnLeagueId: z.string().min(1),
  season: z.number().int().min(2000).max(2100),
  swid: z.string().min(5),
  espnS2: z.string().min(10),
  myEspnTeamId: z.number().int(),
  name: z.string().optional(),
});

const previewSchema = z.object({
  espnLeagueId: z.string().min(1),
  season: z.number().int().min(2000).max(2100),
  swid: z.string().min(5),
  espnS2: z.string().min(10),
});

export async function previewEspnLeague(input: z.infer<typeof previewSchema>) {
  const parsed = previewSchema.parse(input);
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not authenticated");

  try {
    const preview = await fetchEspnTeamsPreview({
      leagueId: parsed.espnLeagueId,
      season: parsed.season,
      cookies: { swid: parsed.swid, espnS2: parsed.espnS2 },
    });
    return {
      ok: true as const,
      name: preview.name,
      scoring: preview.scoring,
      teams: preview.teams.map((t) => ({
        espnTeamId: t.espnTeamId,
        name: t.name,
        abbrev: t.abbrev,
      })),
    };
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "ESPN preview failed",
    };
  }
}

export async function connectLeague(input: z.infer<typeof connectSchema>) {
  const parsed = connectSchema.parse(input);
  const result = await connectEspnLeague(parsed);
  if (result.ok) {
    revalidatePath("/leagues");
    revalidatePath(`/leagues/${result.leagueId}`);
  }
  return result;
}

export async function refreshLeague(leagueId: string) {
  const result = await syncEspnLeague(leagueId);
  if (result.ok) {
    revalidatePath("/leagues");
    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath(`/leagues/${leagueId}/start-sit`);
    revalidatePath(`/leagues/${leagueId}/trades`);
    revalidatePath(`/leagues/${leagueId}/waivers`);
  }
  return result;
}

export async function reconnectEspnCookies(
  leagueId: string,
  cookies: { swid: string; espnS2: string },
) {
  const updated = await updateEspnCredentials(leagueId, cookies);
  if (!updated.ok) return updated;
  const result = await syncEspnLeague(leagueId);
  revalidatePath(`/leagues/${leagueId}`);
  return result;
}

export async function deleteLeague(leagueId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("leagues").delete().eq("id", leagueId);
  if (error) throw new Error(error.message);
  revalidatePath("/leagues");
  revalidatePath("/");
}

export async function refreshLeagueProjections(leagueId: string) {
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("season, scoring, current_week")
    .eq("id", leagueId)
    .single();
  if (!league) return { ok: false as const, message: "League not found" };

  const week = league.current_week && league.current_week > 0 ? league.current_week : 0;
  const result = await syncProjectionsForSeason({
    season: league.season,
    scoring: league.scoring as "STD" | "PPR" | "HALF",
    weeks: week > 0 ? [0, week] : [0],
  });
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/start-sit`);
  revalidatePath(`/leagues/${leagueId}/waivers`);
  revalidatePath(`/leagues/${leagueId}/trades`);
  if (result.ok) return result;
  return { ok: false as const, message: result.message };
}
