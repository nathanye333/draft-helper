import { describe, expect, it } from "vitest";
import {
  DIGEST_LOOKBACK_HOURS,
  filterToDigestWindow,
  isWithinDigestWindow,
} from "./digest-window";
import { formatLookbackLabel } from "./email/templates";

const now = new Date("2026-08-30T13:00:00.000Z");

function hoursAgo(hours: number): string {
  return new Date(now.getTime() - hours * 3600_000).toISOString();
}

describe("isWithinDigestWindow", () => {
  it("keeps an article published an hour ago", () => {
    expect(isWithinDigestWindow({ publishedAt: hoursAgo(1) }, now)).toBe(true);
  });

  it("keeps an article just inside the window", () => {
    expect(isWithinDigestWindow({ publishedAt: hoursAgo(23.5) }, now)).toBe(true);
  });

  it("drops an article just outside the window", () => {
    expect(isWithinDigestWindow({ publishedAt: hoursAgo(25) }, now)).toBe(false);
  });

  it("drops a week-old article", () => {
    expect(isWithinDigestWindow({ publishedAt: hoursAgo(24 * 7) }, now)).toBe(false);
  });

  it("drops undated articles rather than assuming they are fresh", () => {
    expect(isWithinDigestWindow({ publishedAt: null }, now)).toBe(false);
  });

  it("drops unparseable dates", () => {
    expect(isWithinDigestWindow({ publishedAt: "not a date" }, now)).toBe(false);
  });

  it("tolerates small clock skew on just-published articles", () => {
    const slightlyFuture = new Date(now.getTime() + 10 * 60_000).toISOString();
    expect(isWithinDigestWindow({ publishedAt: slightlyFuture }, now)).toBe(true);
  });

  it("drops implausibly future dates", () => {
    const farFuture = new Date(now.getTime() + 48 * 3600_000).toISOString();
    expect(isWithinDigestWindow({ publishedAt: farFuture }, now)).toBe(false);
  });

  it("honours a custom lookback", () => {
    expect(isWithinDigestWindow({ publishedAt: hoursAgo(40) }, now, 48)).toBe(true);
    expect(isWithinDigestWindow({ publishedAt: hoursAgo(40) }, now, 24)).toBe(false);
  });
});

describe("filterToDigestWindow", () => {
  it("keeps only in-window articles and preserves order", () => {
    const items = [
      { id: "a", publishedAt: hoursAgo(2) },
      { id: "b", publishedAt: hoursAgo(72) },
      { id: "c", publishedAt: hoursAgo(6) },
      { id: "d", publishedAt: null },
    ];
    expect(filterToDigestWindow(items, now).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("defaults to a 24 hour window", () => {
    expect(DIGEST_LOOKBACK_HOURS).toBe(24);
  });
});

describe("formatLookbackLabel", () => {
  it("describes the default window", () => {
    expect(formatLookbackLabel(24)).toBe("last 24 hours");
    expect(formatLookbackLabel(undefined)).toBe("last 24 hours");
  });

  it("describes multi-day and partial windows", () => {
    expect(formatLookbackLabel(48)).toBe("last 2 days");
    expect(formatLookbackLabel(36)).toBe("last 36 hours");
  });
});
