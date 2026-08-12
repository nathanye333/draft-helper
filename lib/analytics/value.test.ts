import { describe, expect, it } from "vitest";
import { classifyAdpDelta, computeAdpDelta } from "./value";

describe("computeAdpDelta", () => {
  it("returns pick_number - rank_adp", () => {
    expect(computeAdpDelta(5, 20)).toBe(-15);
    expect(computeAdpDelta(35, 20)).toBe(15);
    expect(computeAdpDelta(20, 20)).toBe(0);
  });

  it("returns null when there is no ADP data", () => {
    expect(computeAdpDelta(5, null)).toBeNull();
  });
});

describe("classifyAdpDelta", () => {
  it("labels boundaries correctly", () => {
    expect(classifyAdpDelta(-15)).toBe("Major Reach");
    expect(classifyAdpDelta(-20)).toBe("Major Reach");
    expect(classifyAdpDelta(-14)).toBe("Reach");
    expect(classifyAdpDelta(-6)).toBe("Reach");
    expect(classifyAdpDelta(-5)).toBe("Fair");
    expect(classifyAdpDelta(0)).toBe("Fair");
    expect(classifyAdpDelta(5)).toBe("Fair");
    expect(classifyAdpDelta(6)).toBe("Value");
    expect(classifyAdpDelta(14)).toBe("Value");
    expect(classifyAdpDelta(15)).toBe("Major Steal");
    expect(classifyAdpDelta(30)).toBe("Major Steal");
  });

  it("returns 'No Data' when adpDelta is null", () => {
    expect(classifyAdpDelta(null)).toBe("No Data");
  });
});
