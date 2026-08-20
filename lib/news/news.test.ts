import { describe, expect, it } from "vitest";
import { normalizeTitle, urlHash } from "@/lib/news/dedupe";
import { buildPlayerMatchIndex, matchPlayersInText } from "@/lib/news/player-match";
import { isInjuryRelatedFlair, parseRedditFlair } from "@/lib/news/sources/reddit";
import { classifySeverity, scoreNewsItem } from "@/lib/news/rank";
import { isRecentHit } from "@/lib/news/aggregate";
import type { RosterPlayerForNews } from "@/lib/news/types";

const samplePlayers: RosterPlayerForNews[] = [
  {
    espnPlayerId: 1,
    name: "Patrick Mahomes",
    position: "QB",
    nflTeam: "KC",
    lineupSlot: "QB",
    injuryStatus: "QUESTIONABLE",
    headshotUrl: null,
    isStarter: true,
    scope: "roster",
  },
  {
    espnPlayerId: 2,
    name: "Michael Carter",
    position: "RB",
    nflTeam: "ARI",
    lineupSlot: "BENCH",
    injuryStatus: null,
    headshotUrl: null,
    isStarter: false,
    scope: "roster",
  },
];

describe("news player matching", () => {
  it("matches full player names in headlines", () => {
    const index = buildPlayerMatchIndex(samplePlayers);
    const matched = matchPlayersInText("Patrick Mahomes ruled questionable for Sunday", index);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.espnPlayerId).toBe(1);
  });

  it("disambiguates common names with team context", () => {
    const index = buildPlayerMatchIndex([
      ...samplePlayers,
      {
        espnPlayerId: 3,
        name: "Michael Carter",
        position: "RB",
        nflTeam: "NYJ",
        lineupSlot: "BENCH",
        injuryStatus: null,
        headshotUrl: null,
        isStarter: false,
        scope: "watchlist",
      },
    ]);
    const matched = matchPlayersInText("ARI Michael Carter placed on IR", index);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.espnPlayerId).toBe(2);
  });
});

describe("news ranking", () => {
  it("classifies out injuries from headline keywords", () => {
    const severity = classifySeverity(
      {
        title: "Star RB ruled out for Week 1",
        url: "https://example.com/out",
        snippet: "",
        source: "espn",
        publishedAt: null,
      },
      [{ espnPlayerId: 1, name: "Patrick Mahomes", scope: "roster" }],
    );
    expect(severity).toBe("out");
  });

  it("scores starter roster news higher than bench", () => {
    const playersById = new Map(samplePlayers.map((p) => [p.espnPlayerId, p]));
    const starterScore = scoreNewsItem({
      hit: {
        title: "Mahomes injury update",
        url: "https://example.com/1",
        snippet: "questionable",
        source: "espn",
        publishedAt: new Date().toISOString(),
      },
      matchedPlayers: [{ espnPlayerId: 1, name: "Patrick Mahomes", scope: "roster" }],
      playersById,
      corroborationCount: 2,
    });
    const benchScore = scoreNewsItem({
      hit: {
        title: "Carter injury update",
        url: "https://example.com/2",
        snippet: "questionable",
        source: "espn",
        publishedAt: new Date().toISOString(),
      },
      matchedPlayers: [{ espnPlayerId: 2, name: "Michael Carter", scope: "roster" }],
      playersById,
      corroborationCount: 1,
    });
    expect(starterScore).toBeGreaterThan(benchScore);
  });
});

describe("reddit helpers", () => {
  it("parses reddit flair from title", () => {
    expect(parseRedditFlair("[Injury] Player ruled out")).toEqual({
      flair: "Injury",
      cleanTitle: "Player ruled out",
    });
    expect(isInjuryRelatedFlair("Injury")).toBe(true);
  });
});

describe("dedupe helpers", () => {
  it("hashes urls consistently", () => {
    expect(urlHash("https://Example.com/A")).toBe(urlHash("https://example.com/a"));
    expect(normalizeTitle("Hello — World!")).toBe("hello world");
  });
});

describe("news recency filter", () => {
  it("drops items older than 30 days", () => {
    const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 312 * 24 * 60 * 60 * 1000).toISOString();
    expect(isRecentHit({ publishedAt: recent })).toBe(true);
    expect(isRecentHit({ publishedAt: old })).toBe(false);
  });
});
