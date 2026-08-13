import { computeAdpDelta } from "@/lib/analytics/value";
import { getTeamPositionForPick } from "@/lib/draft/snake";
import type { Position, RosterSlot, SlotType } from "@/lib/supabase/types";

const FLEX_ELIGIBLE: Position[] = ["RB", "WR", "TE"];
const TOP_TIER_SIZE = 12;

export interface RecommendationCandidate {
  fpPlayerId: string;
  name: string;
  position: Position;
  rankAdp: number | null;
  rankEcr: number | null;
}

export interface Recommendation {
  fpPlayerId: string;
  name: string;
  position: Position;
  score: number;
  rationale: string;
}

interface ComputeRecommendationsParams {
  candidates: RecommendationCandidate[];
  currentPickNumber: number;
  numTeams: number;
  userDraftPosition: number;
  rosterSlots: Pick<RosterSlot, "slot_type" | "count" | "sort_order">[];
  userAssignedSlots: SlotType[];
  limit?: number;
}

/** How many picks from now until this draft position is next on the clock (>= 1). */
export function picksUntilNextTurn(
  currentPickNumber: number,
  numTeams: number,
  draftPosition: number,
): number {
  for (let ahead = 1; ahead <= numTeams * 2; ahead++) {
    if (getTeamPositionForPick(currentPickNumber + ahead, numTeams) === draftPosition) {
      return ahead;
    }
  }
  return numTeams;
}

function slotCapacity(
  slotType: SlotType,
  rosterSlots: Pick<RosterSlot, "slot_type" | "count">[],
) {
  return rosterSlots
    .filter((s) => s.slot_type === slotType)
    .reduce((sum, s) => sum + s.count, 0);
}

function emptyStarterSlotsForPosition(
  position: Position,
  rosterSlots: Pick<RosterSlot, "slot_type" | "count" | "sort_order">[],
  assignedSlots: SlotType[],
): number {
  const filledCount = (slotType: SlotType) => assignedSlots.filter((s) => s === slotType).length;
  const directCapacity = slotCapacity(position as unknown as SlotType, rosterSlots);
  const directRemaining = Math.max(0, directCapacity - filledCount(position as unknown as SlotType));

  if (!FLEX_ELIGIBLE.includes(position)) return directRemaining;

  const flexCapacity = slotCapacity("FLEX", rosterSlots);
  const flexRemaining = Math.max(0, flexCapacity - filledCount("FLEX"));
  return directRemaining + flexRemaining;
}

function totalStarterSlots(
  rosterSlots: Pick<RosterSlot, "slot_type" | "count">[],
): number {
  return rosterSlots.filter((s) => s.slot_type !== "BENCH").reduce((sum, s) => sum + s.count, 0);
}

/**
 * Scores each available candidate for the user's team at the current pick,
 * per the plan's weighted formula:
 *
 *   score = value_bonus * 0.5 + position_need * 0.3 + scarcity * 0.2
 *   value_bonus   = current_pick_number - rank_adp   (positive = available past ADP)
 *   position_need = empty_starter_slots[pos] / total_starter_slots
 *   scarcity      = top_N_remaining_at_position / picks_until_next_user_pick
 *
 * Returns the top `limit` candidates (default 10) sorted by score descending.
 */
export function computeRecommendations({
  candidates,
  currentPickNumber,
  numTeams,
  userDraftPosition,
  rosterSlots,
  userAssignedSlots,
  limit = 10,
}: ComputeRecommendationsParams): Recommendation[] {
  const totalStarters = totalStarterSlots(rosterSlots);
  const untilNextTurn = picksUntilNextTurn(currentPickNumber, numTeams, userDraftPosition);

  const remainingCountByPosition = new Map<Position, number>();
  for (const c of candidates) {
    if (c.rankEcr == null || c.rankEcr > TOP_TIER_SIZE) continue;
    remainingCountByPosition.set(c.position, (remainingCountByPosition.get(c.position) ?? 0) + 1);
  }

  const scored = candidates.map((c) => {
    const valueBonus = computeAdpDelta(currentPickNumber, c.rankAdp) ?? 0;
    const emptySlots = emptyStarterSlotsForPosition(c.position, rosterSlots, userAssignedSlots);
    const positionNeed = totalStarters > 0 ? emptySlots / totalStarters : 0;
    const topRemaining = remainingCountByPosition.get(c.position) ?? 0;
    const scarcity = topRemaining / untilNextTurn;

    const score = valueBonus * 0.5 + positionNeed * 0.3 + scarcity * 0.2;

    return {
      fpPlayerId: c.fpPlayerId,
      name: c.name,
      position: c.position,
      score,
      rationale: buildRationale(c, valueBonus, emptySlots, topRemaining),
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildRationale(
  candidate: RecommendationCandidate,
  valueBonus: number,
  emptySlots: number,
  topRemaining: number,
): string {
  const parts: string[] = [];

  if (emptySlots > 0) parts.push(`${candidate.position} need`);

  if (candidate.rankAdp != null) {
    if (valueBonus > 0) parts.push(`+${Math.round(valueBonus)} ADP value`);
    else if (valueBonus < 0) parts.push(`${Math.round(Math.abs(valueBonus))} ahead of ADP`);
  }

  if (topRemaining > 0) {
    parts.push(`${topRemaining} top-${TOP_TIER_SIZE} ${candidate.position}${topRemaining === 1 ? "" : "s"} left`);
  }

  return parts.length > 0 ? parts.join(", ") : "Best player available";
}

export interface RecommendationVM extends Recommendation {
  byeWeek: number | null;
  nflTeam: string | null;
  rankAdp: number | null;
}

/** Enrich scored recommendations with board metadata for filtering/display. */
export function toRecommendationVMs(
  recommendations: Recommendation[],
  availablePlayers: Array<{
    fpPlayerId: string;
    position: Position;
    byeWeek: number | null;
    nflTeam: string | null;
    rankAdp: number | null;
  }>,
): RecommendationVM[] {
  const byId = new Map(availablePlayers.map((p) => [p.fpPlayerId, p]));
  return recommendations.map((rec) => {
    const meta = byId.get(rec.fpPlayerId);
    return {
      ...rec,
      byeWeek: meta?.byeWeek ?? null,
      nflTeam: meta?.nflTeam ?? null,
      rankAdp: meta?.rankAdp ?? null,
    };
  });
}
