import { fetchSubredditRss, type RssSearchResult } from "@/lib/news/sources/rss";
import type { RawNewsHit } from "@/lib/news/types";

export const REDDIT_SUBREDDITS = ["fantasyfootball", "nfl"] as const;

const USER_AGENT =
  "Mozilla/5.0 (compatible; FantasyDraftHelper/0.1; +https://github.com/nathanye333/draft-helper)";

const INJURY_FLAIRS = new Set([
  "injury",
  "injuries",
  "official",
  "news",
  "update",
  "practice report",
  "gameday",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reddit RSS titles often include flair in brackets, e.g. "[Injury] Player ruled out". */
export function parseRedditFlair(title: string): { flair: string | null; cleanTitle: string } {
  const match = title.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!match) return { flair: null, cleanTitle: title.trim() };
  return { flair: match[1].trim(), cleanTitle: match[2].trim() || title.trim() };
}

export function isInjuryRelatedFlair(flair: string | null): boolean {
  if (!flair) return false;
  const normalized = flair.toLowerCase();
  return [...INJURY_FLAIRS].some((f) => normalized.includes(f));
}

function rssResultsToHits(
  batch: RssSearchResult[],
  injuryFlairOnly?: boolean,
): RawNewsHit[] {
  const hits: RawNewsHit[] = [];
  for (const item of batch) {
    const { flair, cleanTitle } = parseRedditFlair(item.title);
    if (injuryFlairOnly && flair && !isInjuryRelatedFlair(flair)) continue;
    hits.push({
      title: cleanTitle,
      url: item.url,
      snippet: item.snippet,
      source: "reddit",
      publishedAt: item.publishedAt,
      redditFlair: flair,
    });
  }
  return hits;
}

/** Fallback when Reddit serves Atom RSS with HTTP errors — public JSON listing. */
export async function fetchSubredditJson(
  subreddit: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<RssSearchResult[]> {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${Math.min(maxResults, 25)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: signal ?? AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }

  const data = (await res.json()) as {
    data?: {
      children?: Array<{
        data?: {
          title?: string;
          url?: string;
          selftext?: string;
          permalink?: string;
          created_utc?: number;
        };
      }>;
    };
  };

  const items: RssSearchResult[] = [];
  for (const child of data.data?.children ?? []) {
    const post = child.data;
    if (!post?.title) continue;
    const permalink = post.permalink
      ? `https://www.reddit.com${post.permalink}`
      : post.url ?? "";
    items.push({
      title: post.title,
      url: post.url?.startsWith("http") ? post.url : permalink,
      snippet: (post.selftext ?? "").slice(0, 800),
      source: "reddit",
      publishedAt:
        post.created_utc != null
          ? new Date(post.created_utc * 1000).toISOString()
          : null,
    });
    if (items.length >= maxResults) break;
  }
  return items;
}

async function fetchOneSubreddit(
  subreddit: string,
  maxPerSub: number,
  signal?: AbortSignal,
): Promise<RssSearchResult[]> {
  try {
    return await fetchSubredditRss(subreddit, maxPerSub, signal);
  } catch (rssErr) {
    console.warn(
      `[reddit] RSS failed for r/${subreddit}:`,
      rssErr instanceof Error ? rssErr.message : rssErr,
    );
    return fetchSubredditJson(subreddit, maxPerSub, signal);
  }
}

export async function fetchRedditFeeds(options: {
  maxPerSub?: number;
  signal?: AbortSignal;
  injuryFlairOnly?: boolean;
}): Promise<RawNewsHit[]> {
  const maxPerSub = options.maxPerSub ?? 15;
  const hits: RawNewsHit[] = [];

  for (let i = 0; i < REDDIT_SUBREDDITS.length; i += 1) {
    const sub = REDDIT_SUBREDDITS[i]!;
    if (i > 0) await sleep(400);
    try {
      const batch = await fetchOneSubreddit(sub, maxPerSub, options.signal);
      hits.push(...rssResultsToHits(batch, options.injuryFlairOnly));
    } catch (err) {
      console.warn(
        `[reddit] r/${sub} unavailable:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return hits;
}
