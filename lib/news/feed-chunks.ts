import { urlHash } from "@/lib/news/dedupe";
import { splitBodyIntoChunks } from "@/lib/news/relevant-chunks";
import {
  rankChunksForFeedItem,
  type FeedItemForChunkRank,
} from "@/lib/news/chunk-ranking";
import type { NewsItemView } from "@/lib/news/types";

export interface FeedChunkResult {
  urlHash: string;
  newsItemId: string;
  title: string;
  snippet: string;
  source: string;
  publishedAt: string | null;
  content: string;
  relevanceScore: number;
  chunkIndex: number;
}

type SupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
    };
  };
};

export function newsItemsToChunkRankInput(
  items: NewsItemView[],
): FeedItemForChunkRank[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    snippet: item.snippet,
    score: item.score,
    bucket: item.bucket,
    matchedPlayers: item.matchedPlayers,
  }));
}

/** Rank stored (or fallback) body passages per feed item — no global semantic query. */
export async function loadRankedFeedChunks(
  supabase: SupabaseClient,
  items: FeedItemForChunkRank[],
  opts: { maxChunksPerItem?: number; maxItems?: number } = {},
): Promise<FeedChunkResult[]> {
  const maxChunksPerItem = opts.maxChunksPerItem ?? 2;
  const maxItems = opts.maxItems ?? 48;
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.score - a.score).slice(0, maxItems);
  const hashes = sorted.map((i) => i.id);

  const { data: itemRows, error: itemError } = await supabase
    .from("news_items")
    .select("id, url_hash, title, snippet, source, published_at, body")
    .in("url_hash", hashes);

  if (itemError || !itemRows?.length) return [];

  const idByHash = new Map(
    itemRows.map((r) => [String(r.url_hash), String(r.id)]),
  );
  const metaByHash = new Map(itemRows.map((r) => [String(r.url_hash), r]));
  const ids = [...idByHash.values()];

  const { data: chunkRows } = await supabase
    .from("news_body_chunks")
    .select("news_item_id, chunk_index, content")
    .in("news_item_id", ids);

  const chunksByItemId = new Map<
    string,
    Array<{ chunkIndex: number; content: string }>
  >();
  for (const row of chunkRows ?? []) {
    const itemId = String(row.news_item_id);
    const list = chunksByItemId.get(itemId) ?? [];
    list.push({
      chunkIndex: Number(row.chunk_index),
      content: String(row.content),
    });
    chunksByItemId.set(itemId, list);
  }

  const results: FeedChunkResult[] = [];

  for (const item of sorted) {
    const meta = metaByHash.get(item.id);
    const newsItemId = idByHash.get(item.id);
    if (!meta || !newsItemId) continue;

    let storedChunks = chunksByItemId.get(newsItemId) ?? [];
    if (storedChunks.length === 0) {
      const rawBody =
        (typeof meta.body === "string" ? meta.body : null) ||
        (typeof meta.snippet === "string" ? meta.snippet : null) ||
        item.snippet;
      if (rawBody) {
        storedChunks = splitBodyIntoChunks(String(rawBody)).map((content, i) => ({
          chunkIndex: i,
          content,
        }));
      }
    }

    const ranked = rankChunksForFeedItem(storedChunks, item, {
      maxChunks: maxChunksPerItem,
    });

    for (const r of ranked) {
      results.push({
        urlHash: item.id,
        newsItemId,
        title: item.title,
        snippet: item.snippet,
        source: String(meta.source ?? "unknown"),
        publishedAt:
          meta.published_at != null ? String(meta.published_at) : null,
        content: r.content,
        relevanceScore: r.score,
        chunkIndex: r.chunkIndex,
      });
    }
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}

/** Convenience for digest cron — accepts NewsItemView[]. */
export async function excerptsByUrlHashFromFeed(
  supabase: SupabaseClient,
  items: NewsItemView[],
  opts: { maxChunksPerItem?: number; maxChars?: number } = {},
): Promise<Map<string, string>> {
  const maxChars = opts.maxChars ?? 360;
  const ranked = await loadRankedFeedChunks(
    supabase,
    newsItemsToChunkRankInput(items),
    { maxChunksPerItem: opts.maxChunksPerItem ?? 2 },
  );

  const byHash = new Map<string, string[]>();
  for (const row of ranked) {
    const list = byHash.get(row.urlHash) ?? [];
    list.push(row.content);
    byHash.set(row.urlHash, list);
  }

  const out = new Map<string, string>();
  for (const item of items) {
    const hash = urlHash(item.url);
    const pieces = byHash.get(item.id) ?? byHash.get(hash) ?? [];
    if (pieces.length === 0) continue;
    let excerpt = "";
    for (const piece of pieces) {
      const next = excerpt ? `${excerpt} … ${piece}` : piece;
      if (next.length > maxChars) {
        if (!excerpt) excerpt = piece.slice(0, maxChars).trim();
        break;
      }
      excerpt = next;
    }
    if (excerpt) out.set(hash, excerpt.trim());
  }
  return out;
}

/** Digest/cron path — admin client with loose typing to avoid deep Supabase generics. */
export async function semanticExcerptsByUrlHash(
  items: Array<
    Pick<
      NewsItemView,
      "url" | "title" | "snippet" | "matchedPlayers" | "score" | "bucket"
    >
  >,
  opts: { maxChunksPerItem?: number; maxChars?: number } = {},
): Promise<Map<string, string>> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const supabase = createAdminClient() as unknown as SupabaseClient;
  const feedItems: NewsItemView[] = items.map((item) => ({
    id: urlHash(item.url),
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    source: "espn",
    severity: "news",
    bucket: item.bucket ?? "fyi",
    score: item.score ?? 0,
    publishedAt: null,
    matchedPlayers: item.matchedPlayers,
    corroborationCount: 1,
    triageStatus: "new",
  }));
  return excerptsByUrlHashFromFeed(supabase, feedItems, opts);
}
