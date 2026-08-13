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

/** PostgREST returns Postgres `numeric` as strings — coerce for math/sorting. */
function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRanking(row: RankingWithPlayer): RankingWithPlayer {
  return {
    ...row,
    rank_ecr: toNum(row.rank_ecr),
    rank_adp: toNum(row.rank_adp),
    rank_min: toNum(row.rank_min),
    rank_max: toNum(row.rank_max),
    rank_std: toNum(row.rank_std),
    proj_points: toNum(row.proj_points),
    proj_stats:
      row.proj_stats && typeof row.proj_stats === "object"
        ? (row.proj_stats as Record<string, number>)
        : null,
  };
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
 */
export async function fetchDraftBundle(draftId: string): Promise<DraftBundle | null> {
  const supabase = await createClient();

  const { data: draft, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", draftId)
    .single();
  if (draftError || !draft) return null;

  const [teamsRes, slotsRes, rankingsRes, picksRes] = await Promise.all([
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

  const firstError = teamsRes.error ?? slotsRes.error ?? rankingsRes.error ?? picksRes.error;
  if (firstError) {
    throw new Error(`Failed to load draft data: ${firstError.message}`);
  }

  const rankings = ((rankingsRes.data ?? []) as unknown as RankingWithPlayer[])
    .filter((r) => r.players != null)
    .map(normalizeRanking);

  const picks = ((picksRes.data ?? []) as unknown as PickWithDetails[])
    .filter((p) => p.players != null && p.draft_teams != null)
    .map(normalizePick);

  return {
    draft: draft as Draft,
    teams: (teamsRes.data ?? []) as DraftTeam[],
    rosterSlots: (slotsRes.data ?? []) as RosterSlot[],
    rankings,
    picks,
  };
}
