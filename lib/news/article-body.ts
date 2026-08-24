/**
 * Best-effort article body extraction for RAG embeddings.
 * Fetches the news URL, follows redirects, and strips HTML to plain text.
 * Failures return null — callers fall back to title + snippet + metadata.
 */

const USER_AGENT =
  "FantasyDraftHelper/0.1 (+https://github.com; draft-agent news lookup; not a scraper bot)";

const MAX_BODY_CHARS = 6_000;
const FETCH_TIMEOUT_MS = 8_000;

/** Strip scripts/styles/tags and collapse whitespace into plain text. */
export function htmlToPlainText(html: string): string {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    });

  return withoutNoise
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Prefer article/main content regions when present; else full page text. */
export function extractArticleText(html: string): string {
  const articleMatch =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ??
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    html.match(
      /<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:article|story|post-content|entry-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
    );

  const metaDescription =
    html.match(
      /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    html.match(
      /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i,
    )?.[1] ??
    "";

  const ogDescription =
    html.match(
      /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    )?.[1] ??
    html.match(
      /<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["'][^>]*>/i,
    )?.[1] ??
    "";

  const region = articleMatch?.[1] ?? html;
  const body = htmlToPlainText(region);
  const meta = htmlToPlainText(`${metaDescription} ${ogDescription}`);

  // Deduplicate meta if it already appears at the start of body
  const combined =
    meta && !body.toLowerCase().startsWith(meta.toLowerCase().slice(0, 40))
      ? `${meta}\n${body}`
      : body;

  return combined.slice(0, MAX_BODY_CHARS).trim();
}

/**
 * Resolve Google News / aggregator bounce URLs when possible.
 * Returns the final URL after redirects (and a publisher link if found).
 */
function preferPublisherUrl(finalUrl: string, html: string): string | null {
  if (!/news\.google\.com|news\.bing\.com/i.test(finalUrl)) return null;
  const candidates = [
    html.match(/<a\b[^>]*href=["'](https?:\/\/(?!news\.google\.com|news\.bing\.com)[^"']+)["'][^>]*>\s*(?:Read full article|View Full Coverage)/i)?.[1],
    html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["'](https?:\/\/(?!news\.google\.com)[^"']+)["']/i)?.[1],
    html.match(/["'](https?:\/\/(?!news\.google\.com|www\.google\.com)[^"']+)["']\s*,\s*["'][^"']*["']\s*\]/i)?.[1],
  ].filter((u): u is string => Boolean(u));
  return candidates[0] ?? null;
}

export async function fetchArticleBody(url: string): Promise<string | null> {
  const trimmed = url?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;

  try {
    const first = await fetch(trimmed, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!first.ok) return null;
    let html = await first.text();
    let finalUrl = first.url || trimmed;

    const publisher = preferPublisherUrl(finalUrl, html);
    if (publisher) {
      try {
        const second = await fetch(publisher, {
          headers: {
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "User-Agent": USER_AGENT,
          },
          redirect: "follow",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (second.ok) {
          html = await second.text();
          finalUrl = second.url || publisher;
        }
      } catch {
        // keep first page text
      }
    }

    // Skip obviously non-article payloads
    const contentType = first.headers.get("content-type") ?? "";
    if (contentType && !/html|xml|text\/plain/i.test(contentType) && !html.includes("<")) {
      return null;
    }

    const text = extractArticleText(html);
    if (text.length < 80) return null;
    return text;
  } catch (err) {
    console.warn(
      "[fetchArticleBody] failed:",
      trimmed.slice(0, 120),
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
