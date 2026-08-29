import { urlHash } from "@/lib/news/dedupe";
import { splitBodyIntoChunks } from "@/lib/news/relevant-chunks";
import {
  rankChunksForFeedItem,
  type FeedItemForChunkRank,
} from "@/lib/news/chunk-ranking";
import type { NewsItemView } from "@/lib/news/types";
import {
  EXCERPT_CHUNKS_PER_ITEM,
  EXCERPT_JOINER,
  FEED_EXCERPT_MAX_CHARS,
} from "@/lib/news/excerpt-limits";

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
  supabase: unknown,
  items: FeedItemForChunkRank[],
  opts: { maxChunksPerItem?: number; maxItems?: number } = {},
): Promise<FeedChunkResult[]> {
  const db = supabase as SupabaseClient;
  const maxChunksPerItem = opts.maxChunksPerItem ?? EXCERPT_CHUNKS_PER_ITEM;
  const maxItems = opts.maxItems ?? 48;
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.score - a.score).slice(0, maxItems);
  const hashes = sorted.map((i) => i.id);

  const { data: itemRows, error: itemError } = await db
    .from("news_items")
    .select("id, url_hash, title, snippet, source, published_at, body")
    .in("url_hash", hashes);

  if (itemError || !itemRows?.length) return [];

  const idByHash = new Map(
    itemRows.map((r) => [String(r.url_hash), String(r.id)]),
  );
  const metaByHash = new Map(itemRows.map((r) => [String(r.url_hash), r]));
  const ids = [...idByHash.values()];

  const { data: chunkRows } = await db
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
  supabase: unknown,
  items: NewsItemView[],
  opts: { maxChunksPerItem?: number; maxChars?: number } = {},
): Promise<Map<string, string>> {
  const maxChars = opts.maxChars ?? FEED_EXCERPT_MAX_CHARS;
  const ranked = await loadRankedFeedChunks(
    supabase,
    newsItemsToChunkRankInput(items),
    { maxChunksPerItem: opts.maxChunksPerItem ?? EXCERPT_CHUNKS_PER_ITEM },
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
    const excerpt = joinExcerptPieces(pieces, maxChars);
    if (excerpt) out.set(hash, excerpt);
  }
  return out;
}

/**
 * Join ranked passages up to a char budget. A passage that would overflow is
 * truncated at a sentence boundary rather than dropped, so the budget is
 * actually used instead of stopping early on one long paragraph.
 */
export function joinExcerptPieces(pieces: string[], maxChars: number): string {
  let excerpt = "";
  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (!trimmed) continue;

    const candidate = excerpt ? `${excerpt}${EXCERPT_JOINER}${trimmed}` : trimmed;
    if (candidate.length <= maxChars) {
      excerpt = candidate;
      continue;
    }

    const remaining = maxChars - (excerpt ? excerpt.length + EXCERPT_JOINER.length : 0);
    if (remaining < 120) break;

    const clipped = clipToSentence(trimmed, remaining);
    if (!clipped) break;
    excerpt = excerpt ? `${excerpt}${EXCERPT_JOINER}${clipped}` : clipped;
    break;
  }
  return excerpt.trim();
}

/** Trim to the last sentence end within the budget, else the last word break. */
function clipToSentence(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentenceEnd >= maxChars * 0.5) return window.slice(0, sentenceEnd + 1).trim();
  const wordEnd = window.lastIndexOf(" ");
  if (wordEnd >= maxChars * 0.5) return `${window.slice(0, wordEnd).trim()}…`;
  return `${window.trim()}…`;
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
  const supabase = createAdminClient();
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
