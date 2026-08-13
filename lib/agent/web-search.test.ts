import { describe, expect, it } from "vitest";
import { parseRssItems } from "@/lib/agent/web-search";

describe("parseRssItems", () => {
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
});
