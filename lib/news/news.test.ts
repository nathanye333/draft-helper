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
    // Short meta slogans are skipped; article body is the target field.
    expect(text).not.toContain("<p>");
  });

  it("rejects Google News aggregator slogan meta as body", async () => {
    const { extractArticleText, sanitizeArticleText, isAggregatorBoilerplate } = await import(
      "@/lib/news/article-body"
    );
    const slogan =
      "Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News.";
    expect(isAggregatorBoilerplate(slogan)).toBe(true);
    expect(sanitizeArticleText(slogan)).toBeNull();
    expect(sanitizeArticleText(`${slogan}\n${slogan}`)).toBeNull();

    const text = extractArticleText(`
      <html><head>
        <meta name="description" content="${slogan}" />
        <meta property="og:description" content="${slogan}" />
      </head><body><main><p>Google News</p></main></body></html>
    `);
    expect(text).not.toMatch(/comprehensive up-to-date/i);
  });

  it("prefers embedded articleBody over page chrome", async () => {
    const { extractArticleText } = await import("@/lib/news/article-body");
    const text = extractArticleText(`
      <html><body>
        <nav>Scores Watch Betting Stories Sign In</nav>
        <script type="application/ld+json">
          {"@type":"NewsArticle","articleBody":"Patrick Mahomes was limited in practice with an ankle sprain and is expected to play Sunday."}
        </script>
      </body></html>
    `);
    expect(text).toContain("Patrick Mahomes was limited in practice");
    expect(text).not.toContain("Sign In");
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
          excerpt: "Mahomes is ruled out with an ankle sprain and will miss Sunday.",
        },
      ],
      injuryLines: ["Patrick Mahomes: Q → OUT (starter)"],
    });
    expect(subject).toContain("Test League");
    expect(text).toContain("Daily news digest");
    expect(text).toContain("Starter ruled out");
    expect(text).toContain("ankle sprain");
    expect(text).toContain("Patrick Mahomes: Q → OUT (starter)");
    expect(html).toContain("Open news triage");
    expect(html).toContain("ankle sprain");
    expect(html).toContain("https://example.com/leagues/league-1/news");
  });
});

describe("relevant body chunks", () => {
  it("prefers injury passages mentioning the matched player", async () => {
    const { pickRelevantChunks } = await import("@/lib/news/relevant-chunks");
    const body = [
      "The Chiefs opened practice with light stretching and special teams work.",
      "Patrick Mahomes was ruled out with a high-ankle sprain and is expected to miss at least one game.",
      "Kansas City also signed a practice-squad tight end for depth.",
    ].join("\n\n");
    const excerpt = pickRelevantChunks(body, {
      playerNames: ["Patrick Mahomes"],
      maxChunks: 1,
      maxChars: 200,
    });
    expect(excerpt.toLowerCase()).toContain("mahomes");
    expect(excerpt.toLowerCase()).toMatch(/sprain|ruled out/);
    expect(excerpt).not.toContain("practice-squad tight end");
  });
});

describe("feed chunk ranking", () => {
  it("penalizes generic bust-list boilerplate", async () => {
    const { isBoilerplateChunk, scoreChunkForFeedItem } = await import(
      "@/lib/news/chunk-ranking"
    );
    const boilerplate =
      "SportsLine simulated the new NFL season 10,000 times and identified Fantasy football busts 2026";
    expect(isBoilerplateChunk(boilerplate)).toBe(true);

    const item = {
      id: "abc",
      title: "Breece Hall injury update",
      snippet: "",
      score: 12,
      bucket: "needs_action" as const,
      matchedPlayers: [{ espnPlayerId: 1, name: "Breece Hall", scope: "roster" as const }],
    };

    const injuryPassage =
      "Breece Hall was limited in practice with a knee issue and is questionable for Week 1.";
    expect(scoreChunkForFeedItem(injuryPassage, item)).toBeGreaterThan(
      scoreChunkForFeedItem(boilerplate, item),
    );
  });

  it("prefers passages naming roster players over generic draft copy", async () => {
    const { rankChunksForFeedItem } = await import("@/lib/news/chunk-ranking");
    const item = {
      id: "abc",
      title: "Ja'Marr Chase injury update",
      snippet: "",
      score: 10,
      bucket: "monitor" as const,
      matchedPlayers: [{ espnPlayerId: 2, name: "Ja'Marr Chase", scope: "roster" as const }],
    };
    const ranked = rankChunksForFeedItem(
      [
        {
          chunkIndex: 0,
          content:
            "With training camps in full swing, fantasy draft season is set to begin in earnest.",
        },
        {
          chunkIndex: 1,
          content:
            "Ja'Marr Chase was held out of team drills with a hip flexor strain and is day-to-day.",
        },
      ],
      item,
    );
    expect(ranked[0]?.content).toContain("Chase");
    expect(ranked[0]?.content.toLowerCase()).toMatch(/hip|strain|drills/);
  });
});

describe("semantic body chunk builder", () => {
  it("prefixes passages with title and players for embedding", async () => {
    const { buildBodyChunksForEmbed, cosineSimilarity } = await import(
      "@/lib/news/body-chunks"
    );
    const chunks = buildBodyChunksForEmbed({
      title: "Mahomes injury update",
      body: [
        "Kansas City opened practice with walkthroughs and special teams periods that ran long.",
        "Patrick Mahomes was ruled out with a high-ankle sprain and will miss Sunday's game.",
        "The Chiefs also elevated a practice-squad receiver for depth this week.",
      ].join("\n\n"),
      playerNames: ["Patrick Mahomes"],
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]?.embedInput).toContain("Title: Mahomes injury update");
    expect(chunks[0]?.embedInput).toContain("Players: Patrick Mahomes");
    expect(chunks.some((c) => /ruled out|sprain/i.test(c.content))).toBe(true);

    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
