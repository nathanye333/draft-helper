import { fetchSubredditRss, type RssSearchResult } from "@/lib/news/sources/rss";
import type { RawNewsHit } from "@/lib/news/types";

export const REDDIT_SUBREDDITS = ["fantasyfootball", "nfl"] as const;

const INJURY_FLAIRS = new Set([
  "injury",
  "injuries",
  "official",
  "news",
  "update",
  "practice report",
  "gameday",
]);

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

export async function fetchRedditFeeds(options: {
  maxPerSub?: number;
  signal?: AbortSignal;
  injuryFlairOnly?: boolean;
}): Promise<RawNewsHit[]> {
  const maxPerSub = options.maxPerSub ?? 15;
  const results = await Promise.all(
    REDDIT_SUBREDDITS.map((sub) =>
      fetchSubredditRss(sub, maxPerSub, options.signal).catch(() => [] as RssSearchResult[]),
    ),
  );

  const hits: RawNewsHit[] = [];
  for (const batch of results) {
    for (const item of batch) {
      const { flair, cleanTitle } = parseRedditFlair(item.title);
      if (options.injuryFlairOnly && flair && !isInjuryRelatedFlair(flair)) {
        continue;
      }
      hits.push({
        title: cleanTitle,
        url: item.url,
        snippet: item.snippet,
        source: "reddit",
        publishedAt: item.publishedAt,
        redditFlair: flair,
      });
    }
  }
  return hits;
}
