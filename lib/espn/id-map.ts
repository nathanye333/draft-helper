import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve ESPN player IDs to FantasyPros IDs using player_id_map, then
 * name (+ optional NFL team) fallback against the players table.
 */
export async function resolveEspnToFpIds(
  entries: { espnPlayerId: number; playerName: string; nflTeam: string | null }[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (entries.length === 0) return result;

  const admin = createAdminClient();
  const espnIds = [...new Set(entries.map((e) => e.espnPlayerId))];

  const { data: mapped } = await admin
    .from("player_id_map")
    .select("espn_player_id, fp_player_id")
    .in("espn_player_id", espnIds);

  for (const row of mapped ?? []) {
    result.set(Number(row.espn_player_id), String(row.fp_player_id));
  }

  const unresolved = entries.filter((e) => !result.has(e.espnPlayerId));
  if (unresolved.length === 0) return result;

  const { data: players } = await admin.from("players").select("fp_player_id, name, nfl_team");
  const byName = new Map<string, { fp: string; nfl: string | null }[]>();
  for (const p of players ?? []) {
    const key = normalizeName(String(p.name));
    const list = byName.get(key) ?? [];
    list.push({ fp: String(p.fp_player_id), nfl: p.nfl_team ? String(p.nfl_team) : null });
    byName.set(key, list);
  }

  const newMaps: { espn_player_id: number; fp_player_id: string; player_name: string }[] = [];

  for (const e of unresolved) {
    const candidates = byName.get(normalizeName(e.playerName)) ?? [];
    if (candidates.length === 0) continue;
    let pick = candidates[0];
    if (e.nflTeam && candidates.length > 1) {
      const teamMatch = candidates.find(
        (c) => c.nfl && c.nfl.toUpperCase() === e.nflTeam!.toUpperCase(),
      );
      if (teamMatch) pick = teamMatch;
    }
    result.set(e.espnPlayerId, pick.fp);
    newMaps.push({
      espn_player_id: e.espnPlayerId,
      fp_player_id: pick.fp,
      player_name: e.playerName,
    });
  }

  if (newMaps.length > 0) {
    await admin.from("player_id_map").upsert(newMaps, { onConflict: "espn_player_id" });
  }

  return result;
}

export async function lookupFpIdsForEspn(
  supabase: SupabaseClient,
  espnPlayerIds: number[],
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (espnPlayerIds.length === 0) return map;
  const { data } = await supabase
    .from("player_id_map")
    .select("espn_player_id, fp_player_id")
    .in("espn_player_id", espnPlayerIds);
  for (const row of data ?? []) {
    map.set(Number(row.espn_player_id), String(row.fp_player_id));
  }
  return map;
}
