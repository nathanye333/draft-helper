export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  provider: string;
  note?: string;
}

const USER_AGENT =
  "FantasyDraftHelper/0.1 (+https://github.com; draft-agent news lookup; not a scraper bot)";

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

/** Parse RSS/Atom-ish item blocks into search results. Exported for unit tests. */
export function parseRssItems(xml: string, source: string, limit: number): WebSearchResult[] {
  const items: WebSearchResult[] = [];
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
    if (!title || !url) continue;
    items.push({ title, url, snippet: snippet.slice(0, 400), source });
  }
  return items;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/rss+xml, application/xml, application/json, text/xml, */*",
      "User-Agent": USER_AGENT,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.text();
}

async function searchGoogleNews(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url =
    "https://news.google.com/rss/search?" +
    new URLSearchParams({
      q: query,
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    }).toString();
  const xml = await fetchText(url);
  return parseRssItems(xml, "google-news", maxResults);
}

async function searchBingNews(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url =
    "https://www.bing.com/news/search?" +
    new URLSearchParams({ q: query, format: "rss" }).toString();
  const xml = await fetchText(url);
  return parseRssItems(xml, "bing-news", maxResults);
}

async function searchDuckDuckGoInstant(
  query: string,
  maxResults: number,
): Promise<WebSearchResult[]> {
  const url =
    "https://api.duckduckgo.com/?" +
    new URLSearchParams({
      q: query,
      format: "json",
      no_html: "1",
      skip_disambig: "1",
    }).toString();
  const raw = await fetchText(url, {
    headers: { Accept: "application/json" },
  });
  const data = JSON.parse(raw) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    RelatedTopics?: Array<
      | { Text?: string; FirstURL?: string }
      | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
    >;
  };

  const results: WebSearchResult[] = [];
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.AbstractText.slice(0, 400),
      source: "duckduckgo-instant",
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    if (results.length >= maxResults) break;
    if ("FirstURL" in topic && topic.FirstURL && topic.Text) {
      results.push({
        title: topic.Text.split(" - ")[0] ?? topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text.slice(0, 400),
        source: "duckduckgo-instant",
      });
      continue;
    }
    if ("Topics" in topic && Array.isArray(topic.Topics)) {
      for (const nested of topic.Topics) {
        if (results.length >= maxResults) break;
        if (nested.FirstURL && nested.Text) {
          results.push({
            title: nested.Text.split(" - ")[0] ?? nested.Text,
            url: nested.FirstURL,
            snippet: nested.Text.slice(0, 400),
            source: "duckduckgo-instant",
          });
        }
      }
    }
  }

  return results.slice(0, maxResults);
}

async function searchBrave(query: string, maxResults: number, apiKey: string): Promise<WebSearchResult[]> {
  const url =
    "https://api.search.brave.com/res/v1/web/search?" +
    new URLSearchParams({ q: query, count: String(maxResults) }).toString();
  const raw = await fetchText(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  const data = JSON.parse(raw) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results ?? [])
    .filter((r) => r.title && r.url)
    .slice(0, maxResults)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: (r.description ?? "").slice(0, 400),
      source: "brave",
    }));
}

/**
 * Keyless-first web search for draft-agent news/injury context.
 * Prefer Brave when BRAVE_SEARCH_API_KEY is set; otherwise use news RSS
 * (Google/Bing) and DuckDuckGo Instant Answer JSON — not HTML scraping.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<WebSearchResponse> {
  const limit = Math.min(Math.max(maxResults, 1), 8);
  const trimmed = query.trim();
  if (!trimmed) {
    return { query, results: [], provider: "none", note: "Empty query." };
  }

  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (braveKey) {
    try {
      const results = await searchBrave(trimmed, limit, braveKey);
      if (results.length > 0) {
        return { query: trimmed, results, provider: "brave" };
      }
    } catch (err) {
      // Fall through to keyless providers.
      console.warn("Brave search failed, falling back:", err);
    }
  }

  const errors: string[] = [];
  const providers: Array<{
    name: string;
    run: () => Promise<WebSearchResult[]>;
  }> = [
    { name: "google-news", run: () => searchGoogleNews(trimmed, limit) },
    { name: "bing-news", run: () => searchBingNews(trimmed, limit) },
    { name: "duckduckgo-instant", run: () => searchDuckDuckGoInstant(trimmed, limit) },
  ];

  for (const provider of providers) {
    try {
      const results = await provider.run();
      if (results.length > 0) {
        return { query: trimmed, results, provider: provider.name };
      }
    } catch (err) {
      errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    query: trimmed,
    results: [],
    provider: "none",
    note:
      "No web results. Prefer draft DB tools for ADP/ECR/projections. " +
      (braveKey
        ? `Providers failed: ${errors.join("; ") || "empty results"}.`
        : "Optional: set BRAVE_SEARCH_API_KEY for reliable web search. " +
          (errors.length ? `Providers failed: ${errors.join("; ")}.` : "")),
  };
}
