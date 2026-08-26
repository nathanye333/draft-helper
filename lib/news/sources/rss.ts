import type { NewsSource } from "@/lib/news/types";

export interface RssSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: NewsSource;
  publishedAt: string | null;
}

const USER_AGENT =
  "FantasyDraftHelper/0.1 (+https://github.com; draft-agent news lookup; not a scraper bot)";

export function normalizeSearchQuery(raw: string): string {
  return raw
    .replace(/[“”]/g, '"')
    .replace(/['"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(block: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function parseRssDate(raw: string): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** Parse RSS/Atom-ish item blocks into search results. Exported for unit tests. */
export function parseRssItems(
  xml: string,
  source: NewsSource,
  limit: number,
): RssSearchResult[] {
  const items: RssSearchResult[] = [];
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[0];
    const title = decodeXmlEntities(
      firstMatch(block, [/<title[^>]*>([\s\S]*?)<\/title>/i]),
    );
    const url = decodeXmlEntities(
      firstMatch(block, [
        /<link[^>]*href=["']([^"']+)["']/i,
        /<link[^>]*>([\s\S]*?)<\/link>/i,
        /<guid[^>]*>([\s\S]*?)<\/guid>/i,
      ]),
    );
    const snippet = decodeXmlEntities(
      firstMatch(block, [
        /<description[^>]*>([\s\S]*?)<\/description>/i,
        /<summary[^>]*>([\s\S]*?)<\/summary>/i,
      ]),
    );
    const pubDate = decodeXmlEntities(
      firstMatch(block, [
        /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i,
        /<published[^>]*>([\s\S]*?)<\/published>/i,
        /<updated[^>]*>([\s\S]*?)<\/updated>/i,
      ]),
    );
    if (!title || !url) continue;
    // Google News often ships a generic site slogan or title+outlet HTML — not article text.
    const cleanedSnippet = snippet
      .replace(/comprehensive up-to-date news coverage[\s\S]*?google news\.?/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const looksLikeSlogan = /aggregated from sources all over the world/i.test(cleanedSnippet);
    items.push({
      title,
      url,
      snippet: looksLikeSlogan ? "" : cleanedSnippet.slice(0, 800),
      source,
      publishedAt: parseRssDate(pubDate),
    });
  }
  return items;
}

export async function fetchRssText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/rss+xml, application/xml, application/json, text/xml, */*",
      "User-Agent": USER_AGENT,
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.text();
}

export async function searchGoogleNewsRss(
  query: string,
  maxResults: number,
  source: NewsSource = "google-news",
  signal?: AbortSignal,
): Promise<RssSearchResult[]> {
  const url =
    "https://news.google.com/rss/search?" +
    new URLSearchParams({
      q: query,
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    }).toString();
  const xml = await fetchRssText(url, { signal });
  return parseRssItems(xml, source, maxResults);
}

export async function searchBingNewsRss(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<RssSearchResult[]> {
  const url =
    "https://www.bing.com/news/search?" +
    new URLSearchParams({ q: query, format: "rss" }).toString();
  const xml = await fetchRssText(url, { signal });
  return parseRssItems(xml, "bing-news", maxResults);
}

export async function fetchSubredditRss(
  subreddit: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<RssSearchResult[]> {
  const url = `https://www.reddit.com/r/${subreddit}/.rss`;
  const xml = await fetchRssText(url, { signal });
  return parseRssItems(xml, "reddit", maxResults);
}
