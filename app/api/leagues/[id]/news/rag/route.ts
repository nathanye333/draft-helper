import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { embedText } from "@/lib/news/embeddings";

const bodySchema = z.object({
  query: z.string().min(1).max(500),
  matchCount: z.number().int().min(1).max(20).default(10),
  matchThreshold: z.number().min(0).max(1).default(0.25),
});

export interface RagChunk {
  newsItemId: string;
  urlHash: string;
  title: string;
  snippet: string;
  /** Semantically matched body passage when available. */
  content: string | null;
  body: string | null;
  source: string;
  publishedAt: string | null;
  similarity: number;
  chunkIndex?: number;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const { query, matchCount, matchThreshold } = body.data;

  const embedding = await embedText(query);
  if (!embedding) {
    return NextResponse.json(
      { error: "Embedding unavailable — check OPENAI_API_KEY" },
      { status: 503 },
    );
  }

  // Prefer passage-level matches when body chunks exist.
  const { data: chunkRows, error: chunkError } = await supabase.rpc(
    "match_news_body_chunks",
    {
      query_embedding: JSON.stringify(embedding),
      league_id: leagueId,
      match_count: matchCount,
      match_threshold: matchThreshold,
    },
  );

  if (!chunkError && chunkRows && chunkRows.length > 0) {
    const chunks: RagChunk[] = chunkRows.map(
      (r: {
        news_item_id: string;
        url_hash: string;
        title: string;
        snippet: string | null;
        content: string;
        source: string;
        published_at: string | null;
        similarity: number;
        chunk_index: number;
      }) => ({
        newsItemId: r.news_item_id,
        urlHash: r.url_hash,
        title: r.title,
        snippet: r.snippet ?? "",
        content: r.content,
        body: r.content,
        source: r.source,
        publishedAt: r.published_at,
        similarity: r.similarity,
        chunkIndex: r.chunk_index,
      }),
    );
    return NextResponse.json({ chunks, mode: "body_chunks" });
  }

  const { data: rows, error } = await supabase.rpc("match_news_embeddings", {
    query_embedding: JSON.stringify(embedding),
    league_id: leagueId,
    match_count: matchCount,
    match_threshold: matchThreshold,
  });

  if (error) {
    return NextResponse.json(
      { error: chunkError?.message ?? error.message },
      { status: 500 },
    );
  }

  const chunks: RagChunk[] = (rows ?? []).map(
    (r: {
      news_item_id: string;
      url_hash: string;
      title: string;
      snippet: string | null;
      body: string | null;
      source: string;
      published_at: string | null;
      similarity: number;
    }) => ({
      newsItemId: r.news_item_id,
      urlHash: r.url_hash,
      title: r.title,
      snippet: r.snippet ?? "",
      content: null,
      body: r.body ?? null,
      source: r.source,
      publishedAt: r.published_at,
      similarity: r.similarity,
    }),
  );

  return NextResponse.json({ chunks, mode: "article" });
}
