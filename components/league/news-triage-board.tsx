"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayerLink } from "@/components/league/entity-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { sourceLabel } from "@/lib/news/rank";
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

function openSeasonAgent(leagueId: string, prompt: string) {
  window.dispatchEvent(
    new CustomEvent("season-agent-prompt", {
      detail: { leagueId, prompt },
    }),
  );
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
        if (sourceFilter !== "all") params.set("source", sourceFilter);
        if (bucketFilter !== "all") params.set("bucket", bucketFilter);
        if (sortBy !== "score") params.set("sort", sortBy);
        if (startersOnly) params.set("startersOnly", "1");
        if (unreadOnly) params.set("unreadOnly", "1");
        if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

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
    [leagueId, sourceFilter, bucketFilter, sortBy, startersOnly, unreadOnly, debouncedSearch],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const grouped = useMemo(() => {
    const feed = data?.feed ?? [];
    const buckets: NewsBucket[] = ["needs_action", "monitor", "fyi"];
    return buckets
      .map((bucket) => ({
        bucket,
        items: feed.filter((item) => item.bucket === bucket),
      }))
      .filter((g) => g.items.length > 0);
  }, [data?.feed]);

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
                    onClick={() =>
                      openSeasonAgent(
                        leagueId,
                        `Explain this news for my lineup: "${item.title}". Players: ${item.matchedPlayers.map((p) => p.name).join(", ")}. What should I do?`,
                      )
                    }
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
