import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  fetchRankingsBoard,
  type RankingWithPlayer,
} from "@/lib/rankings/data";
import type { Draft, DraftPick, DraftTeam, Player, RosterSlot } from "@/lib/supabase/types";

export type { RankingWithPlayer };

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

/** PostgREST returns Postgres `numeric` as strings — coerce for math/sorting. */
function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePick(row: PickWithDetails): PickWithDetails {
  return {
    ...row,
    adp_delta: toNum(row.adp_delta),
  };
}

/**
 * Loads everything needed to render the draft room / board / analysis pages
 * in one place. RLS scopes every query to the current authenticated user, so
 * this returns `null` if the draft doesn't exist or isn't owned by them.
 *
 * Pass `includeProjStats` for agent tools that need the full FantasyPros
 * stats blob; UI pages omit it to keep payloads small.
 * Deduped per request via React.cache.
 */
export const fetchDraftBundle = cache(async function fetchDraftBundle(
  draftId: string,
  options: { includeProjStats?: boolean } = {},
): Promise<DraftBundle | null> {
  const supabase = await createClient();

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", draftId)
    .single();
  if (draftError || !draft) return null;

  const typedDraft = draft as Draft;

  const [teamsRes, slotsRes, rankings, picksRes] = await Promise.all([
    supabase.from("draft_teams").select("*").eq("draft_id", draftId).order("draft_position"),
    supabase.from("roster_slots").select("*").eq("draft_id", draftId).order("sort_order"),
    fetchRankingsBoard(typedDraft.season, typedDraft.scoring, {
      includeProjStats: options.includeProjStats,
    }),
    supabase
      .from("draft_picks")
      .select("*, players(*), draft_teams(*)")
      .eq("draft_id", draftId)
      .order("pick_number", { ascending: true }),
  ]);

  const firstError = teamsRes.error ?? slotsRes.error ?? picksRes.error;
  if (firstError) {
    throw new Error(`Failed to load draft data: ${firstError.message}`);
  }

  const picks = ((picksRes.data ?? []) as unknown as PickWithDetails[])
    .filter((p) => p.players != null && p.draft_teams != null)
    .map(normalizePick);

  return {
    draft: typedDraft,
    teams: (teamsRes.data ?? []) as DraftTeam[],
    rosterSlots: (slotsRes.data ?? []) as RosterSlot[],
    rankings,
    picks,
  };
});
