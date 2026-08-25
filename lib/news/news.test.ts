import { describe, expect, it } from "vitest";
import { normalizeTitle, urlHash } from "@/lib/news/dedupe";
import { buildPlayerMatchIndex, matchPlayersInText } from "@/lib/news/player-match";
import { isInjuryRelatedFlair, parseRedditFlair } from "@/lib/news/sources/reddit";
import { classifySeverity, isTopStoryHeadline, scoreNewsItem } from "@/lib/news/rank";
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

describe("top-story headlines", () => {
  it("keeps injury, trade, boom, bust, and standout headlines", () => {
    expect(isTopStoryHeadline("Star RB ruled out for Week 1")).toBe(true);
    expect(isTopStoryHeadline("WR acquired in a trade")).toBe(true);
    expect(isTopStoryHeadline("QB posts career-high fantasy points")).toBe(true);
    expect(isTopStoryHeadline("RB is a fantasy bust after another dud")).toBe(true);
    expect(isTopStoryHeadline("Standout sleeper WR looks like a league winner")).toBe(true);
    expect(isTopStoryHeadline("Practice report schedule released")).toBe(false);
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

describe("reddit spike scoring", () => {
  it("scores fresh high-engagement injury starter posts highly", async () => {
    const { computeSpikeScore, isSpikeAlertWorthy } = await import("@/lib/news/reddit-spikes");
    const spike = computeSpikeScore({
      score: 120,
      numComments: 40,
      ageHours: 1,
      injuryRelated: true,
      matchedStarter: true,
    });
    expect(spike).toBeGreaterThan(80);
    expect(isSpikeAlertWorthy(spike, 120, 40)).toBe(true);
  });

  it("rejects quiet old threads", async () => {
    const { computeSpikeScore, isSpikeAlertWorthy } = await import("@/lib/news/reddit-spikes");
    const spike = computeSpikeScore({
      score: 8,
      numComments: 2,
      ageHours: 5,
      injuryRelated: false,
      matchedStarter: false,
    });
    expect(isSpikeAlertWorthy(spike, 8, 2)).toBe(false);
  });
});

describe("RAG embedding text", () => {
  it("includes players, severity, and body beyond title/caption", async () => {
    const { embeddingText } = await import("@/lib/news/embeddings");
    const text = embeddingText({
      title: "Star RB ruled out",
      snippet: "Coach says he will not play Sunday.",
      body: "The star running back suffered a high-ankle sprain and is expected to miss at least two weeks. Fantasy managers should look to the handcuff.",
      source: "espn",
      severity: "out",
      bucket: "needs_action",
      players: ["Jonathan Taylor (roster)"],
    });
    expect(text).toContain("Star RB ruled out");
    expect(text).toContain("Coach says he will not play Sunday.");
    expect(text).toContain("Players: Jonathan Taylor (roster)");
    expect(text).toContain("Severity: out");
    expect(text).toContain("high-ankle sprain");
  });
});

describe("article body extraction", () => {
  it("prefers article region and strips tags", async () => {
    const { extractArticleText, htmlToPlainText } = await import("@/lib/news/article-body");
    expect(htmlToPlainText("<p>Hello <b>world</b></p>")).toContain("Hello world");
    const text = extractArticleText(`
      <html><head>
        <meta name="description" content="Injury update for Week 3." />
      </head><body>
        <nav>Home Scores</nav>
        <article><p>The quarterback is questionable with a shoulder injury and may be limited in practice.</p></article>
      </body></html>
    `);
    expect(text).toContain("questionable with a shoulder injury");
    expect(text).toContain("Injury update for Week 3");
    expect(text).not.toContain("<p>");
  });
});

describe("digest email template", () => {
  it("renders top stories and injury lines", async () => {
    const { formatDigestEmail } = await import("@/lib/news/email/templates");
    const { subject, text, html } = formatDigestEmail({
      leagueName: "Test League",
      appUrl: "https://example.com",
      leagueId: "league-1",
      items: [
        {
          title: "Starter ruled out",
          url: "https://news.example/out",
          bucket: "needs_action",
          severity: "out",
          source: "espn",
          matchedPlayers: [{ espnPlayerId: 1, name: "Patrick Mahomes", scope: "roster" }],
          score: 10,
        },
      ],
      injuryLines: ["Patrick Mahomes: Q → OUT (starter)"],
    });
    expect(subject).toContain("Test League");
    expect(text).toContain("Daily news digest");
    expect(text).toContain("Starter ruled out");
    expect(text).toContain("Patrick Mahomes: Q → OUT (starter)");
    expect(html).toContain("Open news triage");
    expect(html).toContain("https://example.com/leagues/league-1/news");
  });
});
