import { computeAdpDelta } from "@/lib/analytics/value";
import { getTeamPositionForPick } from "@/lib/draft/snake";
import type { Position, RosterSlot, SlotType } from "@/lib/supabase/types";

const FLEX_ELIGIBLE: Position[] = ["RB", "WR", "TE"];
const TOP_TIER_SIZE = 12;
/** How many rounds ahead of the current pick we still consider "on the board". */
const BOARD_WINDOW_ROUNDS = 3;
/** Cap on fallen-ADP bonus so steals help but don't drown out rank quality. */
const MAX_VALUE_BONUS = 25;

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

/** Best available rank signal (prefer ADP, fall back to ECR). */
function boardRank(c: RecommendationCandidate): number | null {
  if (c.rankAdp != null && Number.isFinite(c.rankAdp)) return c.rankAdp;
  if (c.rankEcr != null && Number.isFinite(c.rankEcr)) return c.rankEcr;
  return null;
}

/**
 * Scores available candidates for the user's team at the current pick.
 *
 *   score = quality + value_bonus * 0.5 + position_need * 8 + scarcity * 4
 *   quality       = -board_rank          (ADP/ECR; lower rank = better)
 *   value_bonus   = clamp(pick - ADP, 0..25)  (only rewards players who have fallen)
 *   position_need = empty_starter_slots[pos] / total_starter_slots
 *   scarcity      = top_N_remaining_at_position / picks_until_next_user_pick
 *
 * Candidates without ADP/ECR, or with ADP far beyond the current board window,
 * are excluded so projection-only deep sleepers cannot outrank real draft targets.
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
  const boardCeiling = currentPickNumber + numTeams * BOARD_WINDOW_ROUNDS;

  const remainingCountByPosition = new Map<Position, number>();
  for (const c of candidates) {
    const rank = boardRank(c);
    if (rank == null || rank > TOP_TIER_SIZE) continue;
    remainingCountByPosition.set(c.position, (remainingCountByPosition.get(c.position) ?? 0) + 1);
  }

  const scored = candidates.flatMap((c) => {
    const rank = boardRank(c);
    if (rank == null) return [];
    // Keep recommendations near the live board — not UDFA/projection filler.
    if (rank > boardCeiling) return [];

    const rawDelta = computeAdpDelta(currentPickNumber, c.rankAdp);
    const valueBonus =
      rawDelta != null && rawDelta > 0 ? Math.min(MAX_VALUE_BONUS, rawDelta) : 0;

    const emptySlots = emptyStarterSlotsForPosition(c.position, rosterSlots, userAssignedSlots);
    const positionNeed = totalStarters > 0 ? emptySlots / totalStarters : 0;
    const topRemaining = remainingCountByPosition.get(c.position) ?? 0;
    const scarcity = topRemaining / untilNextTurn;

    // Quality dominates: ADP 1 ≈ -1, ADP 30 ≈ -30. Need/scarcity are tie-breakers.
    const quality = -rank;
    const score = quality + valueBonus * 0.5 + positionNeed * 8 + scarcity * 4;

    return [
      {
        fpPlayerId: c.fpPlayerId,
        name: c.name,
        position: c.position,
        score,
        rationale: buildRationale(c, rank, valueBonus, emptySlots, topRemaining),
      },
    ];
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildRationale(
  candidate: RecommendationCandidate,
  rank: number,
  valueBonus: number,
  emptySlots: number,
  topRemaining: number,
): string {
  const parts: string[] = [];

  if (emptySlots > 0) parts.push(`${candidate.position} need`);

  if (candidate.rankAdp != null) {
    parts.push(`ADP ${Math.round(candidate.rankAdp)}`);
    if (valueBonus > 0) parts.push(`+${Math.round(valueBonus)} value`);
  } else if (candidate.rankEcr != null) {
    parts.push(`ECR ${Math.round(candidate.rankEcr)}`);
  } else {
    parts.push(`rank ${Math.round(rank)}`);
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
