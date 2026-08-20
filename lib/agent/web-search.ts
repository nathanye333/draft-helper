import {
  normalizeSearchQuery,
  parseRssItems,
  searchBingNewsRss,
  searchGoogleNewsRss,
  fetchRssText,
} from "@/lib/news/sources/rss";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string | null;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  provider?: string;
  note?: string;
}

export { normalizeSearchQuery, parseRssItems };
const NEWS_LOOKBACK_DAYS = 30;

function buildRecentNewsQuery(query: string): string {
  if (/\bwhen:\d+[dwmy]\b/i.test(query)) return query;
  return `${query} when:${NEWS_LOOKBACK_DAYS}d`;
}

export function filterResultsToLastDays(
  results: WebSearchResult[],
  lookbackDays: number,
): WebSearchResult[] {
  const minPublishedAt = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  return results.filter((result) => {
    if (!result.publishedAt) return true;
    const publishedAtMs = Date.parse(result.publishedAt);
    return Number.isNaN(publishedAtMs) || publishedAtMs >= minPublishedAt;
  });
}

async function searchDuckDuckGoInstant(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const url =
    "https://api.duckduckgo.com/?" +
    new URLSearchParams({
      q: query,
      format: "json",
      no_html: "1",
      skip_disambig: "1",
    }).toString();
  const raw = await fetchRssText(url, {
    headers: { Accept: "application/json" },
    signal,
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

async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const url =
    "https://api.search.brave.com/res/v1/web/search?" +
    new URLSearchParams({
      q: query,
      count: String(maxResults),
      freshness: "pm",
    }).toString();
  const raw = await fetchRssText(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal,
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
 * (Google/Bing) and DuckDuckGo Instant Answer JSON — not HTML scraping
 * (cloud IPs often trip DuckDuckGo bot checks on html.duckduckgo.com).
 */
export async function webSearch(
  query: string,
  options: { maxResults?: number; signal?: AbortSignal } = {},
): Promise<WebSearchResponse> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    throw new Error("Search query is empty");
  }

  const limit = Math.min(Math.max(options.maxResults ?? 5, 1), 8);
  const signal = options.signal;
  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  const recentQuery = buildRecentNewsQuery(normalized);

  if (braveKey) {
    try {
      const results = await searchBrave(normalized, limit, braveKey, signal);
      const recentResults = filterResultsToLastDays(results, NEWS_LOOKBACK_DAYS);
      if (recentResults.length > 0) {
        return { query: normalized, results: recentResults, provider: "brave" };
      }
    } catch (err) {
      console.warn("Brave search failed, falling back:", err);
    }
  }

  const errors: string[] = [];
  const providers: Array<{
    name: string;
    run: () => Promise<WebSearchResult[]>;
  }> = [
    {
      name: "google-news",
      run: async () => {
        const rows = await searchGoogleNewsRss(recentQuery, limit, "google-news", signal);
        return rows.map((r) => ({ ...r, source: r.source }));
      },
    },
    {
      name: "bing-news",
      run: async () => {
        const rows = await searchBingNewsRss(recentQuery, limit, signal);
        return rows.map((r) => ({ ...r, source: r.source }));
      },
    },
    {
      name: "duckduckgo-instant",
      run: () => searchDuckDuckGoInstant(normalized, limit, signal),
    },
  ];

  for (const provider of providers) {
    try {
      const results = await provider.run();
      const recentResults = filterResultsToLastDays(results, NEWS_LOOKBACK_DAYS);
      if (recentResults.length > 0) {
        return { query: normalized, results: recentResults, provider: provider.name };
      }
    } catch (err) {
      errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    query: normalized,
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
