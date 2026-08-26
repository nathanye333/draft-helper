/**
 * Best-effort article body extraction for RAG embeddings + digests.
 * Fetches the news URL, unwraps Google News wrappers to the publisher page,
 * and strips HTML to plain text. Failures return null — callers fall back
 * to title + snippet.
 */

const USER_AGENT =
  "FantasyDraftHelper/0.1 (+https://github.com; draft-agent news lookup; not a scraper bot)";

const MAX_BODY_CHARS = 6_000;
const FETCH_TIMEOUT_MS = 8_000;

/** Known aggregator meta descriptions that are not article content. */
const AGGREGATOR_BOILERPLATE = [
  /comprehensive up-to-date news coverage/i,
  /aggregated from sources all over the world by google news/i,
  /microsoft start/i,
  /bing news/i,
];

export function isAggregatorBoilerplate(text: string | null | undefined): boolean {
  const s = text?.trim() ?? "";
  if (!s) return false;
  // Exact/near-exact Google News meta (often duplicated in stored bodies).
  if (AGGREGATOR_BOILERPLATE.some((re) => re.test(s))) return true;
  return false;
}

/** Drop boilerplate lines / return null when nothing useful remains. */
export function sanitizeArticleText(text: string | null | undefined): string | null {
  const raw = text?.trim() ?? "";
  if (!raw) return null;
  const cleaned = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !isAggregatorBoilerplate(line))
    .join("\n")
    .trim();
  if (!cleaned || isAggregatorBoilerplate(cleaned)) return null;
  // Reject pages that are almost only the Google News slogan.
  if (cleaned.length < 80) return null;
  return cleaned;
}

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

function usefulMetaDescription(raw: string): string {
  const meta = htmlToPlainText(raw);
  if (!meta || isAggregatorBoilerplate(meta)) return "";
  // Skip meta that is only a headline echo / site slogan
  if (meta.length < 40) return "";
  return meta;
}

/** Pull articleBody / description from JSON-LD or embedded story JSON. */
export function extractEmbeddedArticleBody(html: string): string {
  const bodies: string[] = [];

  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(match[1]!) as unknown;
      const stack: unknown[] = [parsed];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) continue;
        if (Array.isArray(cur)) {
          stack.push(...cur);
          continue;
        }
        if (typeof cur === "object") {
          const obj = cur as Record<string, unknown>;
          if (typeof obj.articleBody === "string" && obj.articleBody.trim().length > 80) {
            bodies.push(obj.articleBody.trim());
          }
          if (typeof obj.description === "string" && obj.description.trim().length > 80) {
            bodies.push(obj.description.trim());
          }
          if (obj["@graph"]) stack.push(obj["@graph"]);
        }
      }
    } catch {
      // ignore invalid JSON-LD blocks
    }
  }

  // Common CMS embeds: "articleBody":"...."
  const rawField = html.match(/"articleBody"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (rawField?.[1]) {
    try {
      bodies.push(JSON.parse(`"${rawField[1]}"`) as string);
    } catch {
      bodies.push(rawField[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"));
    }
  }

  let best = "";
  for (const body of bodies) {
    const plain = htmlToPlainText(body);
    if (plain.length > best.length) best = plain;
  }
  return best;
}

/** Prefer article/main content regions when present; else full page text. */
export function extractArticleText(html: string): string {
  const embedded = extractEmbeddedArticleBody(html);

  const candidates: string[] = [];
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch?.[1]) candidates.push(articleMatch[1]);
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]) candidates.push(mainMatch[1]);
  const namedMatch = html.match(
    /<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:article-body|article__body|story-body|post-content|entry-content|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
  );
  if (namedMatch?.[1]) candidates.push(namedMatch[1]);

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

  // Avoid tiny chrome nodes (e.g. a "Stories" nav chip matching /story/).
  let regionText = "";
  let bestLen = 0;
  for (const candidate of candidates) {
    const len = htmlToPlainText(candidate).length;
    if (len >= 200 && len > bestLen) {
      bestLen = len;
      regionText = htmlToPlainText(candidate);
    }
  }

  // Prefer structured articleBody (publisher pages often hydrate nav-only HTML).
  const body =
    embedded.length >= 80
      ? embedded
      : regionText || htmlToPlainText(html);

  const meta = usefulMetaDescription(`${metaDescription} ${ogDescription}`);

  // Prefer real body; only prepend meta when it adds useful context.
  const combined =
    meta && body && !body.toLowerCase().startsWith(meta.toLowerCase().slice(0, 40))
      ? `${meta}\n${body}`
      : body || meta;

  return (sanitizeArticleText(combined) ?? "").slice(0, MAX_BODY_CHARS).trim();
}

export function isGoogleNewsArticleUrl(url: string): boolean {
  return /news\.google\.com\/(?:rss\/)?articles\//i.test(url);
}

function googleNewsArticleId(url: string): string | null {
  const match = url.match(/news\.google\.com\/(?:rss\/)?articles\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Resolve post-2024 Google News `articles/CBMi…` wrappers to the publisher URL
 * via the page signature + batchexecute Fbv4je RPC.
 */
export async function resolveGoogleNewsPublisherUrl(
  articleUrl: string,
): Promise<string | null> {
  const articleId = googleNewsArticleId(articleUrl);
  if (!articleId) return null;

  try {
    const pageRes = await fetch(
      `https://news.google.com/rss/articles/${articleId}?oc=5&hl=en-US&gl=US&ceid=US:en`,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!signature || !timestamp) return null;

    const rpcInner = JSON.stringify([
      "garturlreq",
      [
        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X",
        "X",
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      articleId,
      Number(timestamp),
      signature,
    ]);
    const fReq = JSON.stringify([[["Fbv4je", rpcInner, null, "generic"]]]);

    const postRes = await fetch(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Referer: "https://news.google.com/",
          "User-Agent": USER_AGENT,
        },
        body: `f.req=${encodeURIComponent(fReq)}`,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!postRes.ok) return null;

    let body = await postRes.text();
    if (body.startsWith(")]}'")) {
      body = body.split("\n").slice(1).join("\n").trim();
    }
    const lines = body.split("\n");
    if (/^\d+$/.test(lines[0]?.trim() ?? "")) {
      body = lines.slice(1).join("\n");
    }

    // Response may contain multiple length-prefixed JSON chunks; scan for garturlres.
    const wrbMatches = [...body.matchAll(/\["wrb\.fr","Fbv4je","((?:\\.|[^"\\])*)"/g)];
    for (const m of wrbMatches) {
      try {
        const inner = JSON.parse(`"${m[1]}"`) as string;
        const payload = JSON.parse(inner) as unknown;
        if (
          Array.isArray(payload) &&
          payload[0] === "garturlres" &&
          typeof payload[1] === "string" &&
          /^https?:\/\//i.test(payload[1])
        ) {
          return payload[1];
        }
      } catch {
        // try next match
      }
    }

    // Fallback: parse first JSON array envelope
    const arrayMatch = body.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const envelopes = JSON.parse(arrayMatch[0]) as unknown;
        if (Array.isArray(envelopes)) {
          for (const env of envelopes) {
            if (
              Array.isArray(env) &&
              env[0] === "wrb.fr" &&
              env[1] === "Fbv4je" &&
              typeof env[2] === "string"
            ) {
              const payload = JSON.parse(env[2]) as unknown;
              if (
                Array.isArray(payload) &&
                payload[0] === "garturlres" &&
                typeof payload[1] === "string"
              ) {
                return payload[1];
              }
            }
          }
        }
      } catch {
        return null;
      }
    }
    return null;
  } catch (err) {
    console.warn(
      "[resolveGoogleNewsPublisherUrl] failed:",
      articleId.slice(0, 24),
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Resolve Google News / Bing aggregator bounce URLs when possible.
 */
async function preferPublisherUrl(finalUrl: string, html: string): Promise<string | null> {
  if (isGoogleNewsArticleUrl(finalUrl)) {
    const resolved = await resolveGoogleNewsPublisherUrl(finalUrl);
    if (resolved) return resolved;
  }

  if (!/news\.google\.com|news\.bing\.com/i.test(finalUrl)) return null;
  const candidates = [
    html.match(
      /<a\b[^>]*href=["'](https?:\/\/(?!news\.google\.com|news\.bing\.com)[^"']+)["'][^>]*>\s*(?:Read full article|View Full Coverage)/i,
    )?.[1],
    html.match(
      /<link\b[^>]*rel=["']canonical["'][^>]*href=["'](https?:\/\/(?!news\.google\.com)[^"']+)["']/i,
    )?.[1],
    html.match(
      /["'](https?:\/\/(?!news\.google\.com|www\.google\.com)[^"']+)["']\s*,\s*["'][^"']*["']\s*\]/i,
    )?.[1],
  ].filter((u): u is string => Boolean(u));
  return candidates[0] ?? null;
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/html|xml|text\/plain/i.test(contentType) && !html.includes("<")) {
    return null;
  }
  return { html, finalUrl: res.url || url };
}

export async function fetchArticleBody(url: string): Promise<string | null> {
  const trimmed = url?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;

  try {
    // Fast path: unwrap Google News before fetching a useless aggregator shell.
    let target = trimmed;
    if (isGoogleNewsArticleUrl(trimmed)) {
      const publisher = await resolveGoogleNewsPublisherUrl(trimmed);
      if (publisher) target = publisher;
    }

    let page = await fetchHtml(target);
    if (!page) return null;

    const bounced = await preferPublisherUrl(page.finalUrl, page.html);
    if (bounced && bounced !== page.finalUrl) {
      const second = await fetchHtml(bounced);
      if (second) page = second;
    }

    // Still on an aggregator page → do not store Google News slogan as "body".
    const text = extractArticleText(page.html);
    return sanitizeArticleText(text);
  } catch (err) {
    console.warn(
      "[fetchArticleBody] failed:",
      trimmed.slice(0, 120),
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
