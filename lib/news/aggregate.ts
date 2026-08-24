import { normalizeSearchQuery, searchBingNewsRss, searchGoogleNewsRss } from "@/lib/news/sources/rss";
import { fetchRedditFeeds } from "@/lib/news/sources/reddit";
import { buildPlayerMatchIndex, matchPlayersInText } from "@/lib/news/player-match";
import { corroborationCounts, dedupeRawHits, normalizeTitle, urlHash } from "@/lib/news/dedupe";
import { buildInjuryBoard } from "@/lib/news/injury-board";
import { getCachedNews, setCachedNews } from "@/lib/news/cache";
import { persistNewsItems } from "@/lib/news/persist";
import { loadRosterScope } from "@/lib/news/roster-scope";
import { bucketForSeverity, classifySeverity, isTopStoryHeadline, scoreNewsItem } from "@/lib/news/rank";
import type {
  NewsFeedFilter,
  NewsItemView,
  NewsTriageResponse,
  RawNewsHit,
  RosterPlayerForNews,
} from "@/lib/news/types";

const MAX_CONCURRENT = 5;
const NEWS_LOOKBACK_DAYS = 30;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function buildPlayerQuery(player: RosterPlayerForNews): string {
  const team = player.nflTeam ? ` ${player.nflTeam}` : "";
  return `"${player.name}"${team} injury OR inactive OR questionable OR doubtful`;
}

function buildEspnQuery(player: RosterPlayerForNews): string {
  return `site:espn.com "${player.name}" NFL`;
}

function buildRecentNewsQuery(query: string): string {
  if (/\bwhen:\d+[dwmy]\b/i.test(query)) return query;
  return `${query} when:${NEWS_LOOKBACK_DAYS}d`;
}

export function isRecentHit(hit: { publishedAt: string | null }): boolean {
  if (!hit.publishedAt) return true;
  const publishedAtMs = Date.parse(hit.publishedAt);
  if (Number.isNaN(publishedAtMs)) return true;
  const minPublishedAt = Date.now() - NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return publishedAtMs >= minPublishedAt;
}

async function fetchPlayerNews(
  players: RosterPlayerForNews[],
  signal?: AbortSignal,
): Promise<RawNewsHit[]> {
  const rosterPlayers = players.filter((p) => p.scope === "roster" || p.scope === "watchlist");
  const targets = rosterPlayers.slice(0, 12);

  const generalQueries = await mapPool(targets, MAX_CONCURRENT, async (player) => {
    const query = buildRecentNewsQuery(normalizeSearchQuery(buildPlayerQuery(player)));
    try {
      const google = await searchGoogleNewsRss(query, 4, "google-news", signal);
      return google.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
        publishedAt: r.publishedAt,
      }));
    } catch {
      return [] as RawNewsHit[];
    }
  });

  const espnQueries = await mapPool(targets.slice(0, 6), MAX_CONCURRENT, async (player) => {
    const query = buildRecentNewsQuery(normalizeSearchQuery(buildEspnQuery(player)));
    try {
      const google = await searchGoogleNewsRss(query, 3, "espn", signal);
      return google.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: "espn" as const,
        publishedAt: r.publishedAt,
      }));
    } catch {
      return [] as RawNewsHit[];
    }
  });

  let bingBatch: RawNewsHit[] = [];
  if (targets.length > 0) {
    const names = targets
      .slice(0, 5)
      .map((p) => `"${p.name}"`)
      .join(" OR ");
    const query = buildRecentNewsQuery(normalizeSearchQuery(`${names} NFL injury`));
    try {
      const bing = await searchBingNewsRss(query, 8, signal);
      bingBatch = bing.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
        publishedAt: r.publishedAt,
      }));
    } catch {
      bingBatch = [];
    }
  }

  const reddit = await fetchRedditFeeds({ maxPerSub: 12, signal, injuryFlairOnly: false });
  const topStories = await fetchTopStories(signal);

  return [
    ...generalQueries.flat(),
    ...espnQueries.flat(),
    ...bingBatch,
    ...reddit,
    ...topStories,
  ].filter(isRecentHit);
}

async function fetchTopStories(signal?: AbortSignal): Promise<RawNewsHit[]> {
  const queries = [
    "NFL injury OR inactive OR IR OR questionable",
    "NFL fantasy trade OR traded OR acquired",
    "NFL fantasy career high OR monster game OR breakout OR standout OR sleeper",
    "NFL fantasy bust OR dud OR disappointing OR struggled OR worst game",
  ];

  const batches = await mapPool(queries, 3, async (raw) => {
    const query = buildRecentNewsQuery(normalizeSearchQuery(raw));
    try {
      const google = await searchGoogleNewsRss(query, 8, "google-news", signal);
      return google.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
        publishedAt: r.publishedAt,
      }));
    } catch {
      return [] as RawNewsHit[];
    }
  });

  return batches.flat().filter((hit) => isTopStoryHeadline(`${hit.title} ${hit.snippet}`));
}

/** Build a scored news feed for a player scope without persisting (cron-safe). */
export async function buildNewsFeedForPlayers(
  players: RosterPlayerForNews[],
  playersById: Map<number, RosterPlayerForNews>,
  signal?: AbortSignal,
): Promise<NewsItemView[]> {
  const rawHits = await fetchPlayerNews(players, signal);
  const deduped = dedupeRawHits(rawHits);
  const corroboration = corroborationCounts(rawHits);
  const matchIndex = buildPlayerMatchIndex(players);

  const feed: NewsItemView[] = [];
  for (const hit of deduped) {
    const text = `${hit.title} ${hit.snippet}`;
    const matchedPlayers = matchPlayersInText(text, matchIndex);
    if (matchedPlayers.length === 0 && !isTopStoryHeadline(text)) continue;

    const corroborationCount = corroboration.get(normalizeTitle(hit.title)) ?? 1;
    const severity = classifySeverity(hit, matchedPlayers);
    const bucket = bucketForSeverity(severity, matchedPlayers, playersById);
    const score = scoreNewsItem({
      hit,
      matchedPlayers,
      playersById,
      corroborationCount,
    });

    feed.push({
      id: urlHash(hit.url),
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      source: hit.source,
      severity,
      bucket,
      score,
      publishedAt: hit.publishedAt,
      matchedPlayers,
      corroborationCount,
      triageStatus: "new",
      redditFlair: hit.redditFlair ?? null,
    });
  }
  feed.sort((a, b) => b.score - a.score);
  return feed;
}

function applyFilters(feed: NewsItemView[], filter?: NewsFeedFilter): NewsItemView[] {
  if (!filter) return feed;
  return feed.filter((item) => {
    if (filter.source && filter.source !== "all" && item.source !== filter.source) return false;
    if (filter.bucket && filter.bucket !== "all" && item.bucket !== filter.bucket) return false;
    if (filter.startersOnly && !item.matchedPlayers.some((m) => m.scope === "roster")) return false;
    if (filter.unreadOnly && item.triageStatus !== "new") return false;
    return item.triageStatus !== "dismissed";
  });
}

function applySearch(feed: NewsItemView[], search?: string): NewsItemView[] {
  const q = (search ?? "").trim().toLowerCase();
  if (!q) return feed;
  return feed.filter((item) => {
    const haystack = `${item.title} ${item.snippet}`.toLowerCase();
    return haystack.includes(q);
  });
}

type SortBy = "score" | "recency";

function sortFeed(feed: NewsItemView[], sortBy: SortBy): NewsItemView[] {
  const items = [...feed];
  if (sortBy === "score") {
    return items.sort((a, b) => b.score - a.score);
  }

  const toMs = (iso: string | null) => {
    if (!iso) return Number.NEGATIVE_INFINITY;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
  };

  return items.sort((a, b) => {
    const diff = toMs(b.publishedAt) - toMs(a.publishedAt);
    if (diff !== 0) return diff;
    return b.score - a.score;
  });
}

export async function aggregateLeagueNews(params: {
  leagueId: string;
  userId: string;
  refresh?: boolean;
  filter?: NewsFeedFilter;
  search?: string;
  sortBy?: SortBy;
  signal?: AbortSignal;
}): Promise<NewsTriageResponse> {
  const effectiveSortBy: SortBy = params.sortBy ?? "score";

  if (!params.refresh) {
    const cached = getCachedNews(params.leagueId);
    if (cached) {
      const recentFeed = cached.feed.filter(isRecentHit);
      const searched = applySearch(recentFeed, params.search);
      const sorted = sortFeed(searched, effectiveSortBy);
      return { ...cached, feed: applyFilters(sorted, params.filter) };
    }
  }

  const scope = await loadRosterScope(params.leagueId);
  if (!scope) {
    throw new Error("League not found");
  }

  const feed = await buildNewsFeedForPlayers(scope.players, scope.playersById, params.signal);

  let enrichedFeed = feed;
  try {
    const persisted = await persistNewsItems(params.leagueId, params.userId, feed);
    enrichedFeed = feed.map((item) => {
      const row = persisted.get(item.id);
      if (!row) return item;
      return { ...item, id: row.dbId, triageStatus: row.triageStatus };
    });
  } catch (err) {
    console.warn("News persist failed (tables may be missing):", err);
  }

  const injuryBoard = buildInjuryBoard(scope.players, scope.injuryDeltas);

  const searched = applySearch(enrichedFeed, params.search);
  const sorted = sortFeed(searched, effectiveSortBy);

  const response: NewsTriageResponse = {
    fetchedAt: new Date().toISOString(),
    cached: false,
    lastSyncedAt: scope.lastSyncedAt,
    injuryBoard,
    feed: applyFilters(sorted, params.filter),
    providerNotes:
      scope.players.length === 0
        ? "Connect and sync your ESPN league to populate roster news."
        : undefined,
  };

  setCachedNews(params.leagueId, { ...response, feed: enrichedFeed });
  return response;
}
