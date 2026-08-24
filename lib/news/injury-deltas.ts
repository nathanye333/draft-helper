import { createClient } from "@/lib/supabase/server";
import { isHealthyStatus } from "@/lib/news/injury-board";

function normalizeStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  return status.toUpperCase();
}

export interface RecordedInjuryDelta {
  espnPlayerId: number;
  playerName: string;
  fromStatus: string | null;
  toStatus: string;
}

export async function recordInjuryDeltas(
  leagueId: string,
  previous: Array<{
    espn_player_id: number;
    player_name: string;
    injury_status: string | null;
  }>,
  incoming: Array<{
    espn_player_id: number;
    player_name: string;
    injury_status: string | null;
  }>,
): Promise<RecordedInjuryDelta[]> {
  const supabase = await createClient();
  const prevById = new Map(previous.map((p) => [Number(p.espn_player_id), p]));
  const rows: Array<{
    league_id: string;
    espn_player_id: number;
    player_name: string;
    from_status: string | null;
    to_status: string;
  }> = [];

  for (const entry of incoming) {
    const id = Number(entry.espn_player_id);
    const prev = prevById.get(id);
    const from = normalizeStatus(prev?.injury_status);
    const to = normalizeStatus(entry.injury_status);
    if (from === to) continue;
    if (to && isHealthyStatus(to) && (!from || isHealthyStatus(from))) continue;

    rows.push({
      league_id: leagueId,
      espn_player_id: id,
      player_name: String(entry.player_name),
      from_status: from,
      to_status: to ?? "ACTIVE",
    });
  }

  if (rows.length === 0) return [];
  await supabase.from("league_injury_deltas").insert(rows);
  return rows.map((r) => ({
    espnPlayerId: r.espn_player_id,
    playerName: r.player_name,
    fromStatus: r.from_status,
    toStatus: r.to_status,
  }));
}

export async function acknowledgeInjuryDelta(leagueId: string, espnPlayerId: number): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("league_injury_deltas")
    .update({ acknowledged: true })
    .eq("league_id", leagueId)
    .eq("espn_player_id", espnPlayerId)
    .eq("acknowledged", false);
}
