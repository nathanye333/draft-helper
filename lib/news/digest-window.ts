import type { NewsItemView } from "@/lib/news/types";

/**
 * How far back the daily digest looks for articles.
 *
 * The triage page keeps a much longer history (see NEWS_LOOKBACK_DAYS); this
 * window applies only to the emailed digest so it reads as "today's news".
 */
export const DIGEST_LOOKBACK_HOURS = 24;

/**
 * Is this article inside the daily digest window?
 *
 * Undated articles are excluded rather than assumed fresh. Aggregator feeds
 * regularly surface months-old stories with no publish date, and letting those
 * through is what made the digest feel stale. The page feed is deliberately
 * more permissive about missing dates.
 */
export function isWithinDigestWindow(
  item: Pick<NewsItemView, "publishedAt">,
  now: Date = new Date(),
  lookbackHours: number = DIGEST_LOOKBACK_HOURS,
): boolean {
  if (!item.publishedAt) return false;

  const publishedMs = Date.parse(item.publishedAt);
  if (Number.isNaN(publishedMs)) return false;

  const cutoffMs = now.getTime() - lookbackHours * 60 * 60 * 1000;
  // Allow small clock skew so a just-published article is never dropped.
  const maxFutureMs = now.getTime() + 60 * 60 * 1000;
  return publishedMs >= cutoffMs && publishedMs <= maxFutureMs;
}

/** Keep only articles published inside the digest window. */
export function filterToDigestWindow<T extends Pick<NewsItemView, "publishedAt">>(
  items: T[],
  now: Date = new Date(),
  lookbackHours: number = DIGEST_LOOKBACK_HOURS,
): T[] {
  return items.filter((item) => isWithinDigestWindow(item, now, lookbackHours));
}
