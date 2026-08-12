import type { Position } from "@/lib/supabase/types";

export type ScarcityStatus = "run" | "normal" | "falling";

export interface PositionScarcity {
  position: Position;
  draftedCount: number;
  expectedCount: number;
  /** draftedCount / expectedCount; >1 means the position is going faster than ADP suggests. */
  ratio: number | null;
  status: ScarcityStatus;
}

const ALL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
const RUN_THRESHOLD = 1.3;
const FALLING_THRESHOLD = 0.7;

/**
 * For each position, compares how many players have actually been drafted
 * against how many "should" have been drafted by now per consensus ADP
 * (i.e. players ranked at or above the current pick number). A ratio well
 * above 1 signals a run on that position; well below 1 signals it's falling
 * behind ADP (a dead zone / potential value window).
 */
export function computePositionScarcity(
  allRankedPlayers: { position: Position; rankAdp: number | null }[],
  draftedPositions: Position[],
  currentPickNumber: number,
): PositionScarcity[] {
  return ALL_POSITIONS.map((position) => {
    const expectedCount = allRankedPlayers.filter(
      (p) => p.position === position && p.rankAdp != null && p.rankAdp <= currentPickNumber,
    ).length;
    const draftedCount = draftedPositions.filter((p) => p === position).length;
    const ratio = expectedCount > 0 ? draftedCount / expectedCount : null;

    let status: ScarcityStatus = "normal";
    if (ratio != null) {
      if (ratio >= RUN_THRESHOLD) status = "run";
      else if (ratio <= FALLING_THRESHOLD) status = "falling";
    }

    return { position, draftedCount, expectedCount, ratio, status };
  });
}
