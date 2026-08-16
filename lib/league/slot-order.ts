/** ESPN-style slot display order for lineup boards. */
export const LINEUP_SLOT_ORDER = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "SUPERFLEX",
  "OP",
  "DST",
  "K",
  "BENCH",
  "IR",
] as const;

const SLOT_RANK = new Map(LINEUP_SLOT_ORDER.map((s, i) => [s, i]));

export function slotSortKey(slot: string): number {
  return SLOT_RANK.get(slot as (typeof LINEUP_SLOT_ORDER)[number]) ?? 50;
}

export function compareLineupSlots(a: string, b: string): number {
  return slotSortKey(a) - slotSortKey(b);
}

export function isStarterSlot(slot: string): boolean {
  return slot !== "BENCH" && slot !== "IR" && slot !== "UNKNOWN";
}

export type LineupSection = "STARTERS" | "BENCH" | "IR";

export function sectionForSlot(slot: string): LineupSection {
  if (slot === "IR") return "IR";
  if (slot === "BENCH") return "BENCH";
  return "STARTERS";
}
