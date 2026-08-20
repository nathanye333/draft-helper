import { describe, expect, it } from "vitest";
import { normalizeSearchQuery, parseRssItems } from "@/lib/news/sources/rss";
import { filterResultsToLastDays } from "@/lib/agent/web-search";

describe("web-search helpers", () => {
  it("normalizes agent mega-queries", () => {
    expect(
      normalizeSearchQuery(
        `2026 top wide receiver prospects 2026 draft "2026 WR prospects" 'list'`,
      ),
    ).toBe("2026 top wide receiver prospects 2026 draft 2026 WR prospects list");
  });

  it("parses Google News-style RSS items with CDATA", () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title><![CDATA[Star RB ruled out for Week 1]]></title>
          <link>https://news.example/rb-out</link>
          <description><![CDATA[Coach confirmed the injury. <b>Details</b> here.]]></description>
        </item>
        <item>
          <title>WR trade rumors heat up</title>
          <link>https://news.example/wr-trade</link>
          <description>Sources say a deal is close.</description>
        </item>
      </channel></rss>`;

    const results = parseRssItems(xml, "google-news", 5);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "Star RB ruled out for Week 1",
      url: "https://news.example/rb-out",
      source: "google-news",
    });
    expect(results[0].snippet).toContain("Coach confirmed the injury");
    expect(results[0].snippet).not.toContain("<b>");
    expect(results[1].title).toBe("WR trade rumors heat up");
  });

  it("respects limit and skips incomplete items", () => {
    const xml = `
      <rss><channel>
        <item><title>Only title</title></item>
        <item><title>Good one</title><link>https://ok.example</link><description>hi</description></item>
        <item><title>Also good</title><link>https://ok2.example</link></item>
      </channel></rss>`;
    const results = parseRssItems(xml, "bing-news", 1);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://ok.example");
  });

  it("filters out results older than 30 days", () => {
    const now = Date.now();
    const recent = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const stale = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
    const filtered = filterResultsToLastDays(
      [
        { title: "recent", url: "https://a.example", snippet: "", publishedAt: recent },
        { title: "stale", url: "https://b.example", snippet: "", publishedAt: stale },
      ],
      30,
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe("recent");
  });
});
