import { createClient } from "@/lib/supabase/server";

export async function listWatchlistIds(leagueId: string, userId: string): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_watchlist")
    .select("espn_player_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId);
  return (data ?? [])
    .map((row) => Number(row.espn_player_id))
    .filter((id) => Number.isFinite(id));
}

export async function addWatchlistPlayer(params: {
  leagueId: string;
  userId: string;
  espnPlayerId: number;
  playerName: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("league_watchlist").upsert(
    {
      league_id: params.leagueId,
      user_id: params.userId,
      espn_player_id: params.espnPlayerId,
      player_name: params.playerName,
    },
    { onConflict: "league_id,user_id,espn_player_id" },
  );
  if (error) throw new Error(error.message);
}

export async function removeWatchlistPlayer(params: {
  leagueId: string;
  userId: string;
  espnPlayerId: number;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("league_watchlist")
    .delete()
    .eq("league_id", params.leagueId)
    .eq("user_id", params.userId)
    .eq("espn_player_id", params.espnPlayerId);
  if (error) throw new Error(error.message);
}
