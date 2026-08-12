import { describe, expect, it } from "vitest";
import { assignSlot } from "./slots";
import { DEFAULT_ROSTER_SLOTS } from "@/lib/supabase/types";
import type { SlotType } from "@/lib/supabase/types";

describe("assignSlot", () => {
  it("fills the direct starter slot first", () => {
    expect(assignSlot("QB", DEFAULT_ROSTER_SLOTS, [])).toBe("QB");
    expect(assignSlot("RB", DEFAULT_ROSTER_SLOTS, [])).toBe("RB");
  });

  it("fills the second RB slot before overflowing to FLEX", () => {
    const existing: SlotType[] = ["RB"];
    expect(assignSlot("RB", DEFAULT_ROSTER_SLOTS, existing)).toBe("RB");
  });

  it("overflows RB/WR/TE to FLEX once starters are full", () => {
    const existing: SlotType[] = ["RB", "RB"];
    expect(assignSlot("RB", DEFAULT_ROSTER_SLOTS, existing)).toBe("FLEX");
  });

  it("does not send QB/K/DST to FLEX", () => {
    const existing: SlotType[] = ["QB"];
    expect(assignSlot("QB", DEFAULT_ROSTER_SLOTS, existing)).toBe("BENCH");
  });

  it("falls back to BENCH once starters and FLEX are full", () => {
    const existing: SlotType[] = ["RB", "RB", "FLEX"];
    expect(assignSlot("RB", DEFAULT_ROSTER_SLOTS, existing)).toBe("BENCH");
  });

  it("fills BENCH when no other slot matches", () => {
    expect(assignSlot("K", DEFAULT_ROSTER_SLOTS, ["K"])).toBe("BENCH");
  });
});
