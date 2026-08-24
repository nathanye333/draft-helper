import { createClient } from "@/lib/supabase/server";
import { urlHash } from "@/lib/news/dedupe";
import { fetchArticleBody } from "@/lib/news/article-body";
import { embedText, embeddingText } from "@/lib/news/embeddings";
import type { NewsItemView, NewsTriageStatus } from "@/lib/news/types";

export async function persistNewsItems(
  leagueId: string,
  userId: string,
  items: NewsItemView[],
): Promise<Map<string, { dbId: string; triageStatus: NewsTriageStatus }>> {
  const supabase = await createClient();
  const mapping = new Map<string, { dbId: string; triageStatus: NewsTriageStatus }>();

  for (const item of items) {
    const hash = urlHash(item.url);
    const { data: upserted, error } = await supabase
      .from("news_items")
      .upsert(
        {
          url_hash: hash,
          url: item.url,
          title: item.title,
          snippet: item.snippet,
          source: item.source,
          published_at: item.publishedAt,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "url_hash" },
      )
      .select("id")
      .single();

    if (error || !upserted) continue;
    const dbId = String(upserted.id);

    if (item.matchedPlayers.length > 0) {
      await supabase.from("news_item_players").upsert(
        item.matchedPlayers.map((p) => ({
          news_item_id: dbId,
          espn_player_id: p.espnPlayerId,
        })),
        { onConflict: "news_item_id,espn_player_id" },
      );
    }

    const { data: existingState } = await supabase
      .from("news_triage_state")
      .select("status")
      .eq("user_id", userId)
      .eq("league_id", leagueId)
      .eq("news_item_id", dbId)
      .maybeSingle();

    const triageStatus = (existingState?.status as NewsTriageStatus | undefined) ?? "new";
    if (!existingState) {
      await supabase.from("news_triage_state").insert({
        user_id: userId,
        league_id: leagueId,
        news_item_id: dbId,
        status: "new",
      });
    }

    // Enrich + embed asynchronously — don't block the news feed response.
    // Title/caption alone are too thin for accurate RAG; fetch article body.
    void enrichAndEmbed(supabase, dbId, item);

    mapping.set(item.id, { dbId, triageStatus });
  }

  return mapping;
}

async function enrichAndEmbed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  newsItemId: string,
  item: NewsItemView,
) {
  let body: string | null = null;
  {
    const { data: existing, error } = await supabase
      .from("news_items")
      .select("body")
      .eq("id", newsItemId)
      .maybeSingle();
    if (!error && typeof existing?.body === "string" && existing.body.trim().length > 0) {
      body = existing.body;
    }
  }

  if (!body) {
    body = await fetchArticleBody(item.url);
    if (body) {
      const { error } = await supabase
        .from("news_items")
        .update({ body })
        .eq("id", newsItemId);
      if (error) {
        console.warn("[enrichAndEmbed] body update failed:", error.message);
      }
    }
  }

  const embedding = await embedText(
    embeddingText({
      title: item.title,
      snippet: item.snippet,
      body,
      source: item.source,
      severity: item.severity,
      bucket: item.bucket,
      players: item.matchedPlayers.map((p) => `${p.name} (${p.scope})`),
      flair: item.redditFlair ?? null,
    }),
  );
  if (!embedding) return;

  await supabase.from("news_embeddings").upsert(
    { news_item_id: newsItemId, embedding: JSON.stringify(embedding) },
    { onConflict: "news_item_id" },
  );
}

export async function loadTriageStatuses(
  leagueId: string,
  userId: string,
  dbIds: string[],
): Promise<Map<string, NewsTriageStatus>> {
  if (dbIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase
    .from("news_triage_state")
    .select("news_item_id, status")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .in("news_item_id", dbIds);

  return new Map(
    (data ?? []).map((row) => [String(row.news_item_id), row.status as NewsTriageStatus]),
  );
}
