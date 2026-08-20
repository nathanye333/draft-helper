import { NextResponse } from "next/server";
import { z } from "zod";
import { aggregateLeagueNews } from "@/lib/news/aggregate";
import { invalidateNewsCache } from "@/lib/news/cache";
import type { NewsFeedFilter } from "@/lib/news/types";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const querySchema = z.object({
  refresh: z.enum(["0", "1"]).optional(),
  source: z
    .enum(["all", "google-news", "bing-news", "espn", "reddit", "brave", "duckduckgo-instant"])
    .optional(),
  bucket: z.enum(["all", "needs_action", "monitor", "fyi"]).optional(),
  startersOnly: z.enum(["0", "1"]).optional(),
  unreadOnly: z.enum(["0", "1"]).optional(),
  search: z.string().optional(),
  sort: z.enum(["score", "recency"]).optional(),
});

export async function GET(
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

  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const refresh = parsed.data.refresh === "1";
  if (refresh) invalidateNewsCache(leagueId);

  const filter: NewsFeedFilter = {
    source: parsed.data.source ?? "all",
    bucket: parsed.data.bucket ?? "all",
    startersOnly: parsed.data.startersOnly === "1",
    unreadOnly: parsed.data.unreadOnly === "1",
  };

  try {
    const data = await aggregateLeagueNews({
      leagueId,
      userId: userData.user.id,
      refresh,
      filter,
      search: parsed.data.search,
      sortBy: parsed.data.sort,
    });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "News fetch failed" },
      { status: 500 },
    );
  }
}
