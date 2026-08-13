export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Collapse agent-built mega-queries into something DDG accepts cleanly. */
export function normalizeSearchQuery(raw: string): string {
  return raw
    .replace(/[“”]/g, '"')
    .replace(/['"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decode DDG redirect links (`/l/?uddg=...`) when present. */
export function unwrapDuckDuckGoUrl(href: string): string {
  try {
    const absolute = href.startsWith("//")
      ? `https:${href}`
      : href.startsWith("/")
        ? `https://duckduckgo.com${href}`
        : href;
    const url = new URL(absolute);
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return absolute;
  } catch {
    return href;
  }
}

/** Parse organic results from DuckDuckGo's no-JS HTML SERP. */
export function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const linkRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) && results.length < limit) {
    const url = unwrapDuckDuckGoUrl(match[1] ?? "");
    const title = stripTags(match[2] ?? "");
    if (!url || !title) continue;
    if (url.includes("duckduckgo.com/y.js")) continue;

    const after = html.slice(match.index, match.index + 1200);
    const snipMatch =
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(after) ??
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//i.exec(after);
    const snippet = snipMatch ? stripTags(snipMatch[1] ?? "") : "";

    results.push({ title, url, snippet });
  }
  return results;
}

/**
 * Web search via DuckDuckGo HTML (no VQD token).
 * The old duck-duck-scrape path breaks when DDG changes their JS SERP handshake.
 */
export async function webSearch(
  query: string,
  options: { maxResults?: number; signal?: AbortSignal } = {},
): Promise<{ query: string; results: WebSearchResult[] }> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    throw new Error("Search query is empty");
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 8);
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
      accept: "text/html",
    },
    body: new URLSearchParams({ q: normalized }),
    signal: options.signal,
  });

  if (!res.ok) {
    throw new Error(`Web search failed (${res.status})`);
  }

  const html = await res.text();
  if (/challenge|anomaly|captcha/i.test(html) && !html.includes("result__a")) {
    throw new Error("Web search blocked by DuckDuckGo bot check; try again shortly.");
  }

  const results = parseDuckDuckGoHtml(html, maxResults);
  if (results.length === 0) {
    throw new Error("Web search returned no results");
  }

  return { query: normalized, results };
}
