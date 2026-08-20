import { createClient } from "@/lib/supabase/server";
import { urlHash } from "@/lib/news/dedupe";
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

    // Embed asynchronously — fire and forget; don't block the response
    void embedAndStore(supabase, dbId, item.title, item.snippet ?? "");

    mapping.set(item.id, { dbId, triageStatus });
  }

  return mapping;
}

async function embedAndStore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  newsItemId: string,
  title: string,
  snippet: string,
) {
  const embedding = await embedText(embeddingText(title, snippet));
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
