import type { Position, RosterSlot, SlotType } from "@/lib/supabase/types";

const FLEX_ELIGIBLE: Position[] = ["RB", "WR", "TE"];

/**
 * Greedy roster slot assignment for a single pick, run against the picks a
 * team has already made this draft:
 *   1. Fill the first unfilled starter slot matching the player's position.
 *   2. Otherwise fill FLEX if the player is RB/WR/TE and FLEX has room.
 *   3. Otherwise fall back to BENCH.
 */
export function assignSlot(
  position: Position,
  rosterSlots: Pick<RosterSlot, "slot_type" | "count" | "sort_order">[],
  existingAssignments: SlotType[],
): SlotType {
  const slotsByOrder = [...rosterSlots].sort((a, b) => a.sort_order - b.sort_order);
  const filledCount = (slotType: SlotType) =>
    existingAssignments.filter((s) => s === slotType).length;

  const capacityOf = (slotType: SlotType) =>
    slotsByOrder
      .filter((s) => s.slot_type === slotType)
      .reduce((sum, s) => sum + s.count, 0);

  const directSlot = slotsByOrder.find(
    (s) => s.slot_type === (position as unknown as SlotType),
  );
  if (directSlot && filledCount(directSlot.slot_type) < capacityOf(directSlot.slot_type)) {
    return directSlot.slot_type;
  }

  const flexSlot = slotsByOrder.find((s) => s.slot_type === "FLEX");
  if (flexSlot && FLEX_ELIGIBLE.includes(position) && filledCount("FLEX") < capacityOf("FLEX")) {
    return "FLEX";
  }

  return "BENCH";
}
