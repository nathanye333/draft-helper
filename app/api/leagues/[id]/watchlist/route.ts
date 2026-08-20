import { NextResponse } from "next/server";
import { z } from "zod";
import { invalidateNewsCache } from "@/lib/news/cache";
import {
  addWatchlistPlayer,
  listWatchlistIds,
  removeWatchlistPlayer,
} from "@/lib/news/watchlist";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  espnPlayerId: z.number().int(),
  playerName: z.string().min(1).max(120),
});

async function requireLeague(leagueId: string) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!league) return { error: NextResponse.json({ error: "League not found" }, { status: 404 }) };

  return { userId: userData.user.id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const auth = await requireLeague(leagueId);
  if ("error" in auth) return auth.error;
  const ids = await listWatchlistIds(leagueId, auth.userId);
  return NextResponse.json({ espnPlayerIds: ids });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const auth = await requireLeague(leagueId);
  if ("error" in auth) return auth.error;

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    await addWatchlistPlayer({
      leagueId,
      userId: auth.userId,
      espnPlayerId: body.data.espnPlayerId,
      playerName: body.data.playerName,
    });
    invalidateNewsCache(leagueId);
    return NextResponse.json({ ok: true, watched: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Watchlist add failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const auth = await requireLeague(leagueId);
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const espnPlayerId = Number(url.searchParams.get("espnPlayerId"));
  if (!Number.isFinite(espnPlayerId)) {
    return NextResponse.json({ error: "espnPlayerId required" }, { status: 400 });
  }

  try {
    await removeWatchlistPlayer({ leagueId, userId: auth.userId, espnPlayerId });
    invalidateNewsCache(leagueId);
    return NextResponse.json({ ok: true, watched: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Watchlist remove failed" },
      { status: 500 },
    );
  }
}
