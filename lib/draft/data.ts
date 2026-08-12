import { createClient } from "@/lib/supabase/server";
import type { Draft, DraftPick, DraftTeam, Player, PlayerRanking, RosterSlot } from "@/lib/supabase/types";

export interface RankingWithPlayer extends PlayerRanking {
  players: Player;
}

export interface PickWithDetails extends DraftPick {
  players: Player;
  draft_teams: DraftTeam;
}

export interface DraftBundle {
  draft: Draft;
  teams: DraftTeam[];
  rosterSlots: RosterSlot[];
  rankings: RankingWithPlayer[];
  picks: PickWithDetails[];
}

/**
 * Loads everything needed to render the draft room / board / analysis pages
 * in one place. RLS scopes every query to the current authenticated user, so
 * this returns `null` if the draft doesn't exist or isn't owned by them.
 */
export async function fetchDraftBundle(draftId: string): Promise<DraftBundle | null> {
  const supabase = await createClient();

  const { data: draft } = await supabase.from("drafts").select("*").eq("id", draftId).single();
  if (!draft) return null;

  const [{ data: teams }, { data: rosterSlots }, { data: rankings }, { data: picks }] = await Promise.all([
    supabase.from("draft_teams").select("*").eq("draft_id", draftId).order("draft_position"),
    supabase.from("roster_slots").select("*").eq("draft_id", draftId).order("sort_order"),
    supabase
      .from("player_rankings")
      .select("*, players(*)")
      .eq("draft_id", draftId)
      .order("rank_adp", { ascending: true, nullsFirst: false }),
    supabase
      .from("draft_picks")
      .select("*, players(*), draft_teams(*)")
      .eq("draft_id", draftId)
      .order("pick_number", { ascending: true }),
  ]);

  return {
    draft: draft as Draft,
    teams: (teams ?? []) as DraftTeam[],
    rosterSlots: (rosterSlots ?? []) as RosterSlot[],
    rankings: (rankings ?? []) as unknown as RankingWithPlayer[],
    picks: (picks ?? []) as unknown as PickWithDetails[],
  };
}
