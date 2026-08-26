/**
 * Semantic body-chunk indexing + retrieval.
 * Chunks article bodies at enrich time; digests/RAG rank passages by embedding similarity.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/news/embeddings";
import { splitBodyIntoChunks, pickRelevantChunks } from "@/lib/news/relevant-chunks";
import { urlHash } from "@/lib/news/dedupe";
import type { NewsItemView } from "@/lib/news/types";

const CHUNK_TARGET_CHARS = 320;
const MAX_CHUNKS_PER_ARTICLE = 12;

export interface BodyChunkForEmbed {
  chunkIndex: number;
  content: string;
  /** Text embedded (title + players + passage). */
  embedInput: string;
}

/** Build overlapping-ish passage units with retrieval-friendly prefixes. */
export function buildBodyChunksForEmbed(params: {
  title: string;
  body: string;
  playerNames?: string[];
}): BodyChunkForEmbed[] {
  const body = params.body.trim();
  if (!body) return [];

  const passages = splitBodyIntoChunks(body, CHUNK_TARGET_CHARS).slice(
    0,
    MAX_CHUNKS_PER_ARTICLE,
  );
  const units = passages.length > 0 ? passages : [body.slice(0, CHUNK_TARGET_CHARS * 2)];

  const players =
    params.playerNames && params.playerNames.length > 0
      ? `Players: ${params.playerNames.join(", ")}`
      : null;

  return units.map((content, chunkIndex) => {
    const embedInput = [`Title: ${params.title.trim()}`, players, content]
      .filter(Boolean)
      .join("\n");
    return { chunkIndex, content, embedInput };
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

type SupabaseLike = {
  from: (table: string) => {
    delete: () => {
      eq: (
        column: string,
        value: string,
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
    insert: (rows: unknown) => PromiseLike<{ error: { message: string } | null }>;
  };
};

/** Replace stored chunks for an article (delete + insert). */
export async function replaceBodyChunks(
  supabase: SupabaseLike,
  newsItemId: string,
  chunks: Array<BodyChunkForEmbed & { embedding: number[] }>,
): Promise<void> {
  const { error: delError } = await supabase
    .from("news_body_chunks")
    .delete()
    .eq("news_item_id", newsItemId);
  if (delError) {
    console.warn("[replaceBodyChunks] delete:", delError.message);
    return;
  }
  if (chunks.length === 0) return;

  const { error: insError } = await supabase.from("news_body_chunks").insert(
    chunks.map((c) => ({
      news_item_id: newsItemId,
      chunk_index: c.chunkIndex,
      content: c.content,
      embedding: JSON.stringify(c.embedding),
    })),
  );
  if (insError) {
    console.warn("[replaceBodyChunks] insert:", insError.message);
  }
}

/** Chunk + embed a body and persist rows. No-ops without OPENAI_API_KEY. */
export async function indexBodyChunks(
  // User or service-role Supabase client.
  supabase: unknown,
  params: {
    newsItemId: string;
    title: string;
    body: string;
    playerNames?: string[];
  },
): Promise<number> {
  const store = supabase as SupabaseLike;
  const planned = buildBodyChunksForEmbed({
    title: params.title,
    body: params.body,
    playerNames: params.playerNames,
  });
  if (planned.length === 0) {
    await replaceBodyChunks(store, params.newsItemId, []);
    return 0;
  }

  const embedded: Array<BodyChunkForEmbed & { embedding: number[] }> = [];
  for (const chunk of planned) {
    const embedding = await embedText(chunk.embedInput);
    if (!embedding) break;
    embedded.push({ ...chunk, embedding });
  }
  if (embedded.length === 0) return 0;

  await replaceBodyChunks(store, params.newsItemId, embedded);
  return embedded.length;
}

export interface MatchedBodyChunk {
  chunkId: string;
  newsItemId: string;
  chunkIndex: number;
  content: string;
  urlHash: string;
  title: string;
  snippet: string;
  source: string;
  publishedAt: string | null;
  similarity: number;
}

/**
 * Rank stored body chunks for digest items (admin / cron path).
 * Uses per-item hybrid ranking (player + keyword), not global semantic search.
 */
export async function semanticExcerptsByUrlHash(
  items: Array<Pick<NewsItemView, "url" | "title" | "snippet" | "matchedPlayers" | "score" | "bucket">>,
  opts: { maxChunksPerItem?: number; maxChars?: number } = {},
): Promise<Map<string, string>> {
  const { excerptsByUrlHashFromFeed } = await import("@/lib/news/feed-chunks");
  const supabase = createAdminClient();
  const feedItems = items.map((item) => ({
    id: urlHash(item.url),
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    source: "espn" as const,
    severity: "news" as const,
    bucket: item.bucket ?? ("fyi" as const),
    score: item.score ?? 0,
    publishedAt: null,
    matchedPlayers: item.matchedPlayers,
    corroborationCount: 1,
    triageStatus: "new" as const,
  }));
  return excerptsByUrlHashFromFeed(supabase, feedItems, opts);
}

/** Keyword fallback wrapper kept for callers that already have body text. */
export function keywordExcerptFallback(
  text: string | null | undefined,
  playerNames: string[],
  maxChars = 360,
): string {
  return pickRelevantChunks(text, {
    playerNames,
    maxChunks: 2,
    maxChars,
  });
}
