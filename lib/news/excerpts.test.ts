import { describe, expect, it } from "vitest";
import { joinExcerptPieces } from "./feed-chunks";
import { rankChunksForFeedItem } from "./chunk-ranking";
import { excerptParagraphs } from "./email/templates";
import {
  DIGEST_EXCERPT_MAX_CHARS,
  EXCERPT_CHUNKS_PER_ITEM,
  EXCERPT_JOINER,
} from "./excerpt-limits";

const item = {
  id: "hash-1",
  title: "Star RB questionable for Sunday",
  snippet: "He is questionable.",
  score: 20,
  bucket: "needs_action" as const,
  matchedPlayers: [
    { espnPlayerId: 1, name: "Star RB", scope: "roster" as const },
  ],
};

function chunk(index: number, content: string) {
  return { chunkIndex: index, content };
}

describe("joinExcerptPieces", () => {
  it("joins several passages up to the budget", () => {
    const pieces = ["First passage.", "Second passage.", "Third passage."];
    expect(joinExcerptPieces(pieces, 200)).toBe(
      `First passage.${EXCERPT_JOINER}Second passage.${EXCERPT_JOINER}Third passage.`,
    );
  });

  it("uses most of the budget rather than stopping at one long passage", () => {
    const long = `${"word ".repeat(150)}end.`;
    const out = joinExcerptPieces([long], DIGEST_EXCERPT_MAX_CHARS);
    expect(out.length).toBeGreaterThan(DIGEST_EXCERPT_MAX_CHARS * 0.5);
    expect(out.length).toBeLessThanOrEqual(DIGEST_EXCERPT_MAX_CHARS);
  });

  it("truncates an overflowing passage at a sentence boundary", () => {
    const first = "A".repeat(100);
    const second = `${"B".repeat(80)}. ${"C".repeat(400)}`;
    const out = joinExcerptPieces([first, second], 260);
    expect(out.length).toBeLessThanOrEqual(260);
    expect(out.startsWith(first)).toBe(true);
    expect(out).toContain(EXCERPT_JOINER.trim());
  });

  it("never exceeds the budget", () => {
    const pieces = Array.from({ length: 10 }, (_, i) => `${"x".repeat(200)} ${i}.`);
    expect(joinExcerptPieces(pieces, 500).length).toBeLessThanOrEqual(500);
  });
});

describe("rankChunksForFeedItem", () => {
  it("tops up past the score threshold to fill the requested count", () => {
    const chunks = [
      chunk(0, "Star RB is questionable with an ankle injury and did not practice today."),
      chunk(1, "The team said it would monitor his status through the week of preparation."),
      chunk(2, "Weather in the region is expected to stay mild throughout the weekend ahead."),
      chunk(3, "Ticket sales for the upcoming home game have reportedly been very strong."),
      chunk(4, "The stadium renovation project remains on schedule for completion next year."),
    ];
    const ranked = rankChunksForFeedItem(chunks, item, {
      maxChunks: EXCERPT_CHUNKS_PER_ITEM,
    });
    expect(ranked).toHaveLength(EXCERPT_CHUNKS_PER_ITEM);
  });

  it("returns passages in article order for readability", () => {
    const chunks = [
      chunk(0, "Opening paragraph with general background information about the team."),
      chunk(1, "Star RB is questionable with an ankle injury and did not practice today."),
      chunk(2, "Another note about the roster and how the coaching staff plans to adjust."),
    ];
    const ranked = rankChunksForFeedItem(chunks, item, { maxChunks: 3 });
    const indexes = ranked.map((r) => r.chunkIndex);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  });

  it("does not invent passages when there is nothing usable", () => {
    expect(rankChunksForFeedItem([], { ...item, snippet: "" }, { maxChunks: 4 })).toEqual([]);
  });
});

describe("excerptParagraphs", () => {
  it("splits a joined excerpt back into passages", () => {
    const joined = `First passage.${EXCERPT_JOINER}Second passage.`;
    expect(excerptParagraphs(joined)).toEqual(["First passage.", "Second passage."]);
  });

  it("returns a single passage unchanged", () => {
    expect(excerptParagraphs("Only one.")).toEqual(["Only one."]);
  });
});
