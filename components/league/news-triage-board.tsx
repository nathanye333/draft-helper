"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayerLink } from "@/components/league/entity-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { sourceLabel } from "@/lib/news/rank";
import { pickRelevantChunks } from "@/lib/news/relevant-chunks";
import type {
  NewsBucket,
  NewsItemView,
  NewsSource,
  NewsTriageResponse,
  NewsTriageStatus,
} from "@/lib/news/types";

function severityVariant(severity: NewsItemView["severity"]) {
  switch (severity) {
    case "out":
      return "danger" as const;
    case "doubtful":
      return "warning" as const;
    case "questionable":
      return "warning" as const;
    case "rumor":
      return "info" as const;
    default:
      return "default" as const;
  }
}

function bucketTitle(bucket: NewsBucket): string {
  switch (bucket) {
    case "needs_action":
      return "Needs action";
    case "monitor":
      return "Monitor";
    default:
      return "FYI";
  }
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Recently";
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return "Recently";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface FeedChunk {
  urlHash?: string;
  title: string;
  snippet: string;
  content?: string | null;
  body: string | null;
  source: string;
  publishedAt: string | null;
  relevanceScore: number;
}

function chunkPassage(c: FeedChunk): string {
  const passage = c.content?.trim() || "";
  if (passage) return passage;
  return pickRelevantChunks(c.body || c.snippet, {
    maxChunks: 2,
    maxChars: 420,
  });
}

function openSeasonAgent(leagueId: string, prompt: string) {
  window.dispatchEvent(
    new CustomEvent("season-agent-prompt", {
      detail: { leagueId, prompt },
    }),
  );
}

function groupChunksByUrlHash(chunks: FeedChunk[]): Map<string, FeedChunk[]> {
  const map = new Map<string, FeedChunk[]>();
  for (const c of chunks) {
    const key = c.urlHash?.trim();
    if (!key) continue;
    const list = map.get(key) ?? [];
    if (list.length >= 2) continue;
    list.push(c);
    map.set(key, list);
  }
  return map;
}

function toMs(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function applyClientFilters(params: {
  feed: NewsItemView[];
  sourceFilter: NewsSource | "all";
  bucketFilter: NewsBucket | "all";
  sortBy: "score" | "recency";
  startersOnly: boolean;
  unreadOnly: boolean;
  search: string;
}): NewsItemView[] {
  const q = params.search.trim().toLowerCase();
  const filtered = params.feed.filter((item) => {
    if (params.sourceFilter !== "all" && item.source !== params.sourceFilter) return false;
    if (params.bucketFilter !== "all" && item.bucket !== params.bucketFilter) return false;
    if (params.startersOnly && !item.matchedPlayers.some((p) => p.scope === "roster")) return false;
    if (params.unreadOnly && item.triageStatus !== "new") return false;
    if (!q) return true;
    const haystack = `${item.title} ${item.snippet}`.toLowerCase();
    return haystack.includes(q);
  });

  const sorted = [...filtered];
  if (params.sortBy === "score") {
    sorted.sort((a, b) => b.score - a.score);
  } else {
    sorted.sort((a, b) => {
      const diff = toMs(b.publishedAt) - toMs(a.publishedAt);
      if (diff !== 0) return diff;
      return b.score - a.score;
    });
  }
  return sorted;
}

export function NewsTriageBoard({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<NewsTriageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<NewsSource | "all">("all");
  const [bucketFilter, setBucketFilter] = useState<NewsBucket | "all">("all");
  const [sortBy, setSortBy] = useState<"score" | "recency">("score");
  const [startersOnly, setStartersOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [chunksByHash, setChunksByHash] = useState<Map<string, FeedChunk[]>>(new Map());
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(searchText), 250);
    return () => window.clearTimeout(t);
  }, [searchText]);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (refresh) params.set("refresh", "1");

        const res = await fetch(`/api/leagues/${leagueId}/news?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as NewsTriageResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load news");
      } finally {
        setLoading(false);
      }
    },
    [leagueId],
  );

  useEffect(() => {
    void load(false);
  }, [load, leagueId]);

  const loadFeedChunks = useCallback(
    async (feed: NewsItemView[]): Promise<FeedChunk[]> => {
      if (feed.length === 0) {
        setChunksByHash(new Map());
        return [];
      }
      const res = await fetch(`/api/leagues/${leagueId}/news/feed-chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: feed.map((item) => ({
            id: item.id,
            title: item.title,
            snippet: item.snippet,
            score: item.score,
            bucket: item.bucket,
            matchedPlayers: item.matchedPlayers,
          })),
          maxChunksPerItem: 2,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        const msg =
          typeof body.error === "string"
            ? body.error
            : body.error
              ? "Chunk ranking failed (invalid request)"
              : `Chunk ranking failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const json = (await res.json()) as { chunks?: FeedChunk[] };
      const chunks = json.chunks ?? [];
      setChunksByHash(groupChunksByUrlHash(chunks));
      setChunksError(null);
      return chunks;
    },
    [leagueId],
  );

  // Rank body passages per feed item (player + keyword), not global semantic search.
  useEffect(() => {
    if (!data?.feed.length) {
      setChunksByHash(new Map());
      setChunksError(null);
      return;
    }
    let cancelled = false;
    setChunksLoading(true);
    setChunksError(null);

    const run = async () => {
      try {
        await loadFeedChunks(data.feed);
      } catch (err) {
        if (!cancelled) {
          setChunksByHash(new Map());
          setChunksError(err instanceof Error ? err.message : "Failed to load body chunks");
        }
        return false;
      } finally {
        if (!cancelled) setChunksLoading(false);
      }
      return true;
    };

    void run();

    const retry1 = window.setTimeout(() => {
      if (!cancelled) void loadFeedChunks(data.feed).catch(() => undefined);
    }, 5000);
    const retry2 = window.setTimeout(() => {
      if (!cancelled) void loadFeedChunks(data.feed).catch(() => undefined);
    }, 15000);

    return () => {
      cancelled = true;
      window.clearTimeout(retry1);
      window.clearTimeout(retry2);
    };
  }, [data?.feed, data?.fetchedAt, leagueId, loadFeedChunks]);

  const filteredFeed = useMemo(
    () =>
      applyClientFilters({
        feed: data?.feed ?? [],
        sourceFilter,
        bucketFilter,
        sortBy,
        startersOnly,
        unreadOnly,
        search: debouncedSearch,
      }),
    [data?.feed, sourceFilter, bucketFilter, sortBy, startersOnly, unreadOnly, debouncedSearch],
  );

  const grouped = useMemo(() => {
    const buckets: NewsBucket[] = ["needs_action", "monitor", "fyi"];
    return buckets
      .map((bucket) => ({
        bucket,
        items: filteredFeed.filter((item) => item.bucket === bucket),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredFeed]);

  const updateTriage = async (newsItemId: string, status: NewsTriageStatus) => {
    const res = await fetch(`/api/leagues/${leagueId}/news/triage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newsItemId, status }),
    });
    if (!res.ok) return;
    setData((prev) =>
      prev
        ? {
            ...prev,
            feed:
              status === "dismissed"
                ? prev.feed.filter((item) => item.id !== newsItemId)
                : prev.feed.map((item) =>
                    item.id === newsItemId ? { ...item, triageStatus: status } : item,
                  ),
          }
        : prev,
    );
  };

  const openNewsSummary = async () => {
    const feed = filteredFeed;
    if (!feed.length || summaryBusy) return;
    setSummaryBusy(true);

    try {
      // Prefer already-loaded page chunks; refresh if empty.
      let feedChunks = [...chunksByHash.values()].flat();
      if (feedChunks.length === 0) {
        try {
          feedChunks = await loadFeedChunks(feed);
        } catch {
          // fall through to heuristic
        }
      }

      if (feedChunks.length > 0) {
        openSeasonAgent(
          leagueId,
          [
            "Summarize the following NFL fantasy news for my league (each passage is from a story already matched to my roster/watchlist).",
            "Return in 3 sections: (1) Key story themes (up to 6) with one-liners, (2) Lineup/roster impact per theme (injuries, trades, boom-bust, performance), (3) Players/teams to watch next (start/sit, waiver adds, trade targets, monitor).",
            "Use the provided chunk passages as primary evidence. Do not invent numbers. Use league tools if needed for roster/waiver context.",
            "",
            "Ranked body passages (per story, player/keyword scored):",
            JSON.stringify(
              feedChunks.map((c) => ({
                title: c.title,
                chunk: chunkPassage(c) || c.snippet?.slice(0, 400) || undefined,
                source: c.source,
                publishedAt: c.publishedAt,
                relevanceScore: Math.round(c.relevanceScore * 10) / 10,
              })),
              null,
              2,
            ),
          ].join("\n"),
        );
        return;
      }

      const triaged = feed.map((item) => ({
        title: item.title,
        publishedAt: item.publishedAt,
        source: item.source,
        bucket: item.bucket,
        matchedPlayers: item.matchedPlayers.map((p) => `${p.name} (${p.scope})`),
        relevantSnippet: pickRelevantChunks(item.snippet, {
          playerNames: item.matchedPlayers.map((p) => p.name),
          maxChunks: 1,
          maxChars: 220,
        }),
      }));

      openSeasonAgent(
        leagueId,
        [
          "Summarize ALL of the news items currently shown in my triage feed.",
          "For each story, only use the provided relevantSnippet (ignore the rest).",
          "Return in 3 sections: (1) Top story themes (5-6) with one-liners, (2) Why each theme matters to my lineup, (3) Players/teams to watch next.",
          "Use league tools if needed for roster/waiver context. Do not invent numbers.",
          "",
          "News items:",
          JSON.stringify(triaged, null, 2),
        ].join("\n"),
      );
    } finally {
      setSummaryBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-500">Source</label>
          <Select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as NewsSource | "all")}
            className="w-40"
          >
            <option value="all">All sources</option>
            <option value="google-news">Google News</option>
            <option value="bing-news">Bing</option>
            <option value="espn">ESPN</option>
            <option value="reddit">Reddit</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Priority</label>
          <Select
            value={bucketFilter}
            onChange={(e) => setBucketFilter(e.target.value as NewsBucket | "all")}
            className="w-40"
          >
            <option value="all">All priorities</option>
            <option value="needs_action">Needs action</option>
            <option value="monitor">Monitor</option>
            <option value="fyi">FYI</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Sort</label>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as "score" | "recency")} className="w-40">
            <option value="score">Relevance</option>
            <option value="recency">Recency</option>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Search</label>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="title or snippet"
            className="w-64 rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1 text-sm text-slate-100 outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={startersOnly}
            onChange={(e) => setStartersOnly(e.target.checked)}
          />
          Starters only
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
        </label>
        <Button type="button" size="sm" disabled={loading} onClick={() => void load(true)}>
          {loading ? "Refreshing…" : "Refresh news"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={loading || summaryBusy || (filteredFeed?.length ?? 0) === 0}
          onClick={() => void openNewsSummary()}
        >
          {summaryBusy ? "Starting…" : "LLM summary"}
        </Button>
        {chunksLoading ? (
          <span className="text-xs text-slate-500">Loading body chunks…</span>
        ) : chunksByHash.size > 0 ? (
          <span className="text-xs text-slate-500">
            {chunksByHash.size} stories with ranked passages
          </span>
        ) : chunksError ? (
          <span className="text-xs text-amber-500/90">{chunksError}</span>
        ) : null}
        {data?.cached ? (
          <span className="text-xs text-slate-500">Cached feed (10 min)</span>
        ) : null}
        {data?.lastSyncedAt ? (
          <span className="text-xs text-slate-500">
            ESPN synced {formatRelativeTime(data.lastSyncedAt)}
          </span>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {data?.providerNotes ? (
        <p className="text-sm text-slate-400">{data.providerNotes}</p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-slate-500">Loading news feed…</p>
      ) : null}

      {!loading && data && grouped.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-slate-400">
            No matching news for your scoped players. Try Refresh news or Sync ESPN first.
          </CardContent>
        </Card>
      ) : null}

      {grouped.map(({ bucket, items }) => (
        <Card key={bucket}>
          <CardHeader>
            <CardTitle>{bucketTitle(bucket)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => (
              <article
                key={item.id}
                className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
                  <Badge variant="default">{sourceLabel(item.source)}</Badge>
                  {item.redditFlair ? (
                    <Badge variant="info">r/{item.redditFlair}</Badge>
                  ) : null}
                  {item.corroborationCount > 1 ? (
                    <Badge variant="success">{item.corroborationCount} sources</Badge>
                  ) : null}
                  {item.triageStatus !== "new" ? (
                    <Badge variant="default">{item.triageStatus}</Badge>
                  ) : null}
                  <span className="text-xs text-slate-500">
                    {formatRelativeTime(item.publishedAt)}
                  </span>
                </div>
                <h3 className="text-sm font-medium text-slate-100">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-emerald-300 hover:underline"
                  >
                    {item.title}
                  </a>
                </h3>
                {item.snippet ? (
                  <p className="mt-1 text-sm text-slate-400">{item.snippet}</p>
                ) : null}
                {(chunksByHash.get(item.id) ?? []).map((c, idx) => {
                  const passage = chunkPassage(c);
                  if (!passage) return null;
                  return (
                    <p
                      key={`${item.id}-chunk-${idx}`}
                      className="mt-2 border-l-2 border-emerald-800/70 pl-2 text-xs leading-relaxed text-slate-300"
                    >
                      {passage}
                    </p>
                  );
                })}
                {(chunksByHash.get(item.id) ?? []).length === 0 && !chunksLoading
                  ? (() => {
                      const fallback = pickRelevantChunks(item.snippet, {
                        playerNames: item.matchedPlayers.map((p) => p.name),
                        maxChunks: 1,
                        maxChars: 280,
                      });
                      if (!fallback) return null;
                      return (
                        <p className="mt-2 border-l-2 border-slate-700 pl-2 text-xs leading-relaxed text-slate-400">
                          {fallback}
                        </p>
                      );
                    })()
                  : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.matchedPlayers.map((p) => (
                    <PlayerLink key={p.espnPlayerId} leagueId={leagueId} espnPlayerId={p.espnPlayerId}>
                      {p.name}
                    </PlayerLink>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const passages = (chunksByHash.get(item.id) ?? [])
                        .map(chunkPassage)
                        .filter(Boolean);
                      openSeasonAgent(
                        leagueId,
                        [
                          `Explain this news for my lineup: "${item.title}".`,
                          `Players: ${item.matchedPlayers.map((p) => p.name).join(", ") || "—"}.`,
                          passages.length
                            ? `Relevant body chunks:\n${passages.map((p) => `- ${p}`).join("\n")}`
                            : null,
                          "What should I do?",
                        ]
                          .filter(Boolean)
                          .join("\n\n"),
                      );
                    }}
                  >
                    Ask agent
                  </Button>
                  {item.triageStatus === "new" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void updateTriage(item.id, "read")}
                    >
                      Mark read
                    </Button>
                  ) : null}
                  {item.triageStatus !== "dismissed" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void updateTriage(item.id, "dismissed")}
                    >
                      Dismiss
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
