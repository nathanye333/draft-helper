import type { NewsTriageResponse } from "@/lib/news/types";

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  data: NewsTriageResponse;
}

const cache = new Map<string, CacheEntry>();

export function getCachedNews(leagueId: string): NewsTriageResponse | null {
  const entry = cache.get(leagueId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(leagueId);
    return null;
  }
  return { ...entry.data, cached: true };
}

export function setCachedNews(leagueId: string, data: NewsTriageResponse): void {
  cache.set(leagueId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    data: { ...data, cached: false },
  });
}

export function invalidateNewsCache(leagueId: string): void {
  cache.delete(leagueId);
}
