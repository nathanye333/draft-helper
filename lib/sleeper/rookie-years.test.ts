import { describe, expect, it } from "vitest";
import {
  buildDraftYearLookup,
  normalizePlayerName,
  resolveDraftYear,
} from "@/lib/sleeper/rookie-years";

describe("normalizePlayerName", () => {
  it("strips punctuation and suffixes", () => {
    expect(normalizePlayerName("Ja'Marr Chase")).toBe("jamarr chase");
    expect(normalizePlayerName("Kenneth Walker III")).toBe("kenneth walker");
    expect(normalizePlayerName("A.J. Brown")).toBe("aj brown");
  });
});

describe("draft year lookup", () => {
  const lookup = buildDraftYearLookup({
    a: {
      full_name: "Ja'Marr Chase",
      sportradar_id: "fa99e984-d63b-4ef4-a164-407f68a7eeaf",
      yahoo_id: 33393,
      metadata: { rookie_year: "2021" },
    },
    b: {
      full_name: "Bijan Robinson",
      sportradar_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      yahoo_id: "999",
      metadata: { rookie_year: 2023 },
    },
    c: {
      full_name: "Houston Texans",
      position: "DEF",
      metadata: {},
    },
  });

  it("resolves by sportradar / sportsdata id first", () => {
    expect(
      resolveDraftYear(lookup, {
        sportsdataId: "FA99E984-D63B-4EF4-A164-407F68A7EEAF",
        name: "Someone Else",
      }),
    ).toBe(2021);
  });

  it("falls back to yahoo id then normalized name", () => {
    expect(resolveDraftYear(lookup, { yahooId: "999" })).toBe(2023);
    expect(resolveDraftYear(lookup, { name: "Ja'Marr Chase" })).toBe(2021);
  });

  it("returns null when unmatched", () => {
    expect(resolveDraftYear(lookup, { name: "Houston Texans" })).toBeNull();
    expect(resolveDraftYear(lookup, { sportsdataId: "missing" })).toBeNull();
  });
});
