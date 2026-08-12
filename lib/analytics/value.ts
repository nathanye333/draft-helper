export type ValueLabel = "Major Reach" | "Reach" | "Fair" | "Value" | "Major Steal";

/** `pick_number - rank_adp`. Negative means the player was picked earlier than expected (a reach). */
export function computeAdpDelta(pickNumber: number, rankAdp: number | null): number | null {
  if (rankAdp == null) return null;
  return pickNumber - rankAdp;
}

/**
 * Classifies an ADP delta into a human-readable label.
 *   <= -15        Major reach
 *   -14..-6       Reach
 *   -5..+5        Fair
 *   +6..+14       Value / falling
 *   >= +15        Major steal
 */
export function classifyAdpDelta(adpDelta: number | null): ValueLabel | "No Data" {
  if (adpDelta == null) return "No Data";
  if (adpDelta <= -15) return "Major Reach";
  if (adpDelta <= -6) return "Reach";
  if (adpDelta <= 5) return "Fair";
  if (adpDelta <= 14) return "Value";
  return "Major Steal";
}
