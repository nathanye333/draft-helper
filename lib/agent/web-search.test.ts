import { describe, expect, it } from "vitest";
import {
  normalizeSearchQuery,
  parseDuckDuckGoHtml,
  unwrapDuckDuckGoUrl,
} from "@/lib/agent/web-search";

describe("web-search helpers", () => {
  it("normalizes agent mega-queries", () => {
    expect(
      normalizeSearchQuery(
        `2026 top wide receiver prospects 2026 draft "2026 WR prospects" 'list'`,
      ),
    ).toBe("2026 top wide receiver prospects 2026 draft 2026 WR prospects list");
  });

  it("unwraps DDG redirect urls", () => {
    const href =
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.espn.com%2Fnfl%2Finjuries&rut=abc";
    expect(unwrapDuckDuckGoUrl(href)).toBe("https://www.espn.com/nfl/injuries");
  });

  it("parses HTML SERP anchors and snippets", () => {
    const html = `
      <div class="result__body">
        <a class="result__a" href="https://example.com/a">Example <b>Title</b></a>
        <a class="result__snippet" href="https://example.com/a">A short <b>snippet</b> here</a>
      </div>
      <div class="result__body">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example%2Fb">News</a>
        <a class="result__snippet" href="https://news.example/b">More news</a>
      </div>
    `;
    const results = parseDuckDuckGoHtml(html, 5);
    expect(results).toEqual([
      {
        title: "Example Title",
        url: "https://example.com/a",
        snippet: "A short snippet here",
      },
      {
        title: "News",
        url: "https://news.example/b",
        snippet: "More news",
      },
    ]);
  });
});
