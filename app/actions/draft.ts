"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { syncRankingsForDraft } from "@/lib/fantasypros/sync";
import { getRoundForPick, getTeamPositionForPick } from "@/lib/draft/snake";
import { assignSlot } from "@/lib/draft/slots";
import { computeAdpDelta } from "@/lib/analytics/value";
import type { Position, SlotType } from "@/lib/supabase/types";

const createDraftSchema = z.object({
  name: z.string().min(1),
  season: z.number().int().min(2000).max(2100),
  numTeams: z.number().int().min(2).max(20),
  scoring: z.enum(["STD", "PPR", "HALF"]),
  teams: z
    .array(
      z.object({
        name: z.string().min(1),
        draftPosition: z.number().int().min(1),
        isUserTeam: z.boolean(),
      }),
    )
    .min(2),
  rosterSlots: z
    .array(
      z.object({
        slotType: z.enum(["QB", "RB", "WR", "TE", "FLEX", "K", "DST", "BENCH", "IR"]),
        count: z.number().int().min(1),
        sortOrder: z.number().int(),
      }),
    )
    .min(1),
});

export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export async function createDraft(input: CreateDraftInput) {
  const parsed = createDraftSchema.parse(input);
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not authenticated");

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .insert({
      user_id: userData.user.id,
      name: parsed.name,
      season: parsed.season,
      num_teams: parsed.numTeams,
      scoring: parsed.scoring,
      draft_type: "snake",
      status: "setup",
    })
    .select()
    .single();

  if (draftError || !draft) throw new Error(draftError?.message ?? "Failed to create draft");

  const { data: teams, error: teamsError } = await supabase
    .from("draft_teams")
    .insert(
      parsed.teams.map((t) => ({
        draft_id: draft.id,
        name: t.name,
        draft_position: t.draftPosition,
        is_user_team: t.isUserTeam,
      })),
    )
    .select();

  if (teamsError) throw new Error(teamsError.message);

  const userTeam = teams?.find((t) => t.is_user_team);
  if (userTeam) {
    await supabase.from("drafts").update({ my_team_id: userTeam.id }).eq("id", draft.id);
  }

  const { error: slotsError } = await supabase.from("roster_slots").insert(
    parsed.rosterSlots.map((s) => ({
      draft_id: draft.id,
      slot_type: s.slotType,
      count: s.count,
      sort_order: s.sortOrder,
    })),
  );

  if (slotsError) throw new Error(slotsError.message);

  return { draftId: draft.id as string };
}

export async function syncDraftRankings(draftId: string) {
  const result = await syncRankingsForDraft(draftId);
  revalidatePath(`/drafts/${draftId}/setup`);
  return result;
}

export async function startDraft(draftId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("drafts").update({ status: "live" }).eq("id", draftId);
  if (error) throw new Error(error.message);
  revalidatePath(`/drafts/${draftId}`);
}

export async function completeDraft(draftId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("drafts").update({ status: "complete" }).eq("id", draftId);
  if (error) throw new Error(error.message);
  revalidatePath(`/drafts/${draftId}`);
}

export async function deleteDraft(draftId: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error("Not authenticated");

  const { error } = await supabase.from("drafts").delete().eq("id", draftId);
  if (error) throw new Error(error.message);

  revalidatePath("/");
}

const logPickSchema = z.object({
  draftId: z.string().uuid(),
  fpPlayerId: z.string().min(1),
  teamId: z.string().uuid().optional(),
});

export type LogPickInput = z.infer<typeof logPickSchema>;

function revalidateDraftPaths(draftId: string) {
  revalidatePath(`/drafts/${draftId}`);
  revalidatePath(`/drafts/${draftId}/board`);
  revalidatePath(`/drafts/${draftId}/analysis`);
}

export async function logPick(input: LogPickInput) {
  const parsed = logPickSchema.parse(input);
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("drafts")
    .select("num_teams")
    .eq("id", parsed.draftId)
    .single();
  if (!draft) throw new Error("Draft not found");

  const { data: lastPick } = await supabase
    .from("draft_picks")
    .select("pick_number")
    .eq("draft_id", parsed.draftId)
    .order("pick_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const pickNumber = (lastPick?.pick_number ?? 0) + 1;
  const round = getRoundForPick(pickNumber, draft.num_teams);

  let teamId = parsed.teamId;
  if (!teamId) {
    const draftPosition = getTeamPositionForPick(pickNumber, draft.num_teams);
    const { data: team } = await supabase
      .from("draft_teams")
      .select("id")
      .eq("draft_id", parsed.draftId)
      .eq("draft_position", draftPosition)
      .single();
    if (!team) throw new Error("Could not resolve team on the clock");
    teamId = team.id;
  }

  const [{ data: player }, { data: rosterSlots }, { data: existingPicks }, { data: ranking }] =
    await Promise.all([
      supabase.from("players").select("position").eq("fp_player_id", parsed.fpPlayerId).single(),
      supabase.from("roster_slots").select("slot_type, count, sort_order").eq("draft_id", parsed.draftId),
      supabase
        .from("draft_picks")
        .select("assigned_slot_type")
        .eq("draft_id", parsed.draftId)
        .eq("team_id", teamId),
      supabase
        .from("player_rankings")
        .select("rank_adp")
        .eq("draft_id", parsed.draftId)
        .eq("fp_player_id", parsed.fpPlayerId)
        .maybeSingle(),
    ]);

  if (!player) throw new Error("Player not found");

  const assignedSlot = assignSlot(
    player.position as Position,
    rosterSlots ?? [],
    (existingPicks ?? []).map((p) => p.assigned_slot_type as SlotType),
  );

  const adpDelta = computeAdpDelta(pickNumber, ranking?.rank_adp ?? null);

  const { error } = await supabase.from("draft_picks").insert({
    draft_id: parsed.draftId,
    pick_number: pickNumber,
    round,
    team_id: teamId,
    fp_player_id: parsed.fpPlayerId,
    assigned_slot_type: assignedSlot,
    adp_delta: adpDelta,
  });

  if (error) {
    if (error.code === "23505") throw new Error("That player has already been drafted.");
    throw new Error(error.message);
  }

  revalidateDraftPaths(parsed.draftId);
}

export async function undoLastPick(draftId: string) {
  const supabase = await createClient();

  const { data: lastPick } = await supabase
    .from("draft_picks")
    .select("id")
    .eq("draft_id", draftId)
    .order("pick_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastPick) return;

  const { error } = await supabase.from("draft_picks").delete().eq("id", lastPick.id);
  if (error) throw new Error(error.message);

  revalidateDraftPaths(draftId);
}
