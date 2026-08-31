import type { NewsSource } from "@/lib/news/types";

export interface RssSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: NewsSource;
  publishedAt: string | null;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; FantasyDraftHelper/0.1; +https://github.com/nathanye333/draft-helper)";

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

/** Split RSS 2.0 <item> and Atom <entry> blocks from a feed document. */
export function extractFeedBlocks(xml: string): string[] {
  const blocks: string[] = [];
  for (const pattern of [/<item\b[\s\S]*?<\/item>/gi, /<entry\b[\s\S]*?<\/entry>/gi]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml)) !== null) {
      blocks.push(match[0]);
    }
  }
  return blocks;
}

/** Prefer Atom alternate links; skip feed/self/rss endpoints. */
function extractFeedUrl(block: string): string {
  const alternate =
    block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i)?.[1] ??
    block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i)?.[1];
  if (alternate?.trim()) return alternate.trim();

  for (const match of block.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1]?.trim() ?? "";
    if (!href) continue;
    if (/\.rss(?:\?|$)/i.test(href)) continue;
    if (/redditstatic\.com/i.test(href)) continue;
    return href;
  }

  return decodeXmlEntities(
    firstMatch(block, [
      /<link[^>]*>([\s\S]*?)<\/link>/i,
      /<guid[^>]*>([\s\S]*?)<\/guid>/i,
      /<id[^>]*>([\s\S]*?)<\/id>/i,
    ]),
  );
}

function cleanSnippet(snippet: string): string {
  const cleaned = snippet
    .replace(/comprehensive up-to-date news coverage[\s\S]*?google news\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/aggregated from sources all over the world/i.test(cleaned)) return "";
  return cleaned.slice(0, 800);
}

/** Parse one RSS <item> or Atom <entry> block. */
export function parseFeedBlock(block: string, source: NewsSource): RssSearchResult | null {
  const title = decodeXmlEntities(firstMatch(block, [/<title[^>]*>([\s\S]*?)<\/title>/i]));
  const url = extractFeedUrl(block);
  const snippet = decodeXmlEntities(
    firstMatch(block, [
      /<description[^>]*>([\s\S]*?)<\/description>/i,
      /<summary[^>]*>([\s\S]*?)<\/summary>/i,
      /<content[^>]*>([\s\S]*?)<\/content>/i,
    ]),
  );
  const pubDate = decodeXmlEntities(
    firstMatch(block, [
      /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i,
      /<published[^>]*>([\s\S]*?)<\/published>/i,
      /<updated[^>]*>([\s\S]*?)<\/updated>/i,
    ]),
  );
  if (!title || !url) return null;
  return {
    title,
    url,
    snippet: cleanSnippet(snippet),
    source,
    publishedAt: parseRssDate(pubDate),
  };
}

/** Parse RSS 2.0 and Atom feeds (Google/Bing RSS, Reddit Atom). */
export function parseRssItems(
  xml: string,
  source: NewsSource,
  limit: number,
): RssSearchResult[] {
  const items: RssSearchResult[] = [];
  for (const block of extractFeedBlocks(xml)) {
    if (items.length >= limit) break;
    const parsed = parseFeedBlock(block, source);
    if (parsed) items.push(parsed);
  }
  return items;
}

export async function fetchRssText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept:
        "application/rss+xml, application/atom+xml, application/xml, application/json, text/xml, */*",
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
