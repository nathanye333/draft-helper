import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadRankedFeedChunks } from "@/lib/news/feed-chunks";
import type { MatchedPlayerRef, NewsBucket } from "@/lib/news/types";

const itemSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(""),
  snippet: z.string().nullish().transform((s) => s ?? ""),
  score: z.number().default(0),
  bucket: z.enum(["needs_action", "monitor", "fyi"]).default("fyi"),
  matchedPlayers: z
    .array(
      z.object({
        espnPlayerId: z.number(),
        name: z.string(),
        scope: z.enum(["roster", "watchlist", "opponent"]),
      }),
    )
    .default([]),
});

/** Feeds routinely exceed 60 items; ranking is CPU-only so a high cap is safe. */
const MAX_ITEMS = 250;

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(MAX_ITEMS),
  maxChunksPerItem: z.number().int().min(1).max(3).default(2),
});

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

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: issue
          ? `Invalid feed-chunks request: ${issue.path.join(".") || "body"} — ${issue.message}`
          : "Invalid feed-chunks request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const items = parsed.data.items.map((item) => ({
    id: item.id,
    title: item.title,
    snippet: item.snippet,
    score: item.score,
    bucket: item.bucket as NewsBucket,
    matchedPlayers: item.matchedPlayers as MatchedPlayerRef[],
  }));

  const chunks = await loadRankedFeedChunks(supabase, items, {
    maxChunksPerItem: parsed.data.maxChunksPerItem,
  });

  return NextResponse.json({
    mode: "feed_hybrid",
    chunks: chunks.map((c) => ({
      urlHash: c.urlHash,
      title: c.title,
      snippet: c.snippet,
      content: c.content,
      body: c.content,
      source: c.source,
      publishedAt: c.publishedAt,
      relevanceScore: c.relevanceScore,
      chunkIndex: c.chunkIndex,
    })),
  });
}
