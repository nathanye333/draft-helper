import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, userTeam } from "@/lib/league/data";
import { isStarterSlot } from "@/lib/league/slot-order";
import { resolveEspnImageUrl } from "@/lib/espn/player-universe";
import type { InjuryDeltaView, RosterPlayerForNews } from "@/lib/news/types";

export interface RosterScopeResult {
  leagueId: string;
  lastSyncedAt: string | null;
  currentWeek: number | null;
  players: RosterPlayerForNews[];
  playersById: Map<number, RosterPlayerForNews>;
  injuryDeltas: InjuryDeltaView[];
}

function mapEntryToPlayer(
  entry: {
    espn_player_id: number;
    player_name: string;
    position: string;
    nfl_team: string | null;
    lineup_slot: string;
    injury_status: string | null;
  },
  headshotUrl: string | null,
  scope: RosterPlayerForNews["scope"],
): RosterPlayerForNews {
  return {
    espnPlayerId: Number(entry.espn_player_id),
    name: String(entry.player_name),
    position: String(entry.position),
    nflTeam: entry.nfl_team != null ? String(entry.nfl_team) : null,
    lineupSlot: String(entry.lineup_slot),
    injuryStatus: entry.injury_status != null ? String(entry.injury_status) : null,
    headshotUrl,
    isStarter: isStarterSlot(String(entry.lineup_slot)),
    scope,
  };
}

export async function loadRosterScope(leagueId: string): Promise<RosterScopeResult | null> {
  const bundle = await fetchLeagueBundle(leagueId);
  if (!bundle) return null;

  const supabase = await createClient();
  const mine = userTeam(bundle);
  if (!mine) {
    return {
      leagueId,
      lastSyncedAt: bundle.league.last_synced_at,
      currentWeek: bundle.league.current_week,
      players: [],
      playersById: new Map(),
      injuryDeltas: [],
    };
  }

  const rosterEntries = bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id);
  const espnIds = new Set<number>();

  for (const r of rosterEntries) espnIds.add(r.espn_player_id);

  const week = bundle.league.current_week && bundle.league.current_week > 0 ? bundle.league.current_week : null;
  if (week != null) {
    const matchup = bundle.matchups.find(
      (m) =>
        m.week === week &&
        (m.home_espn_team_id === mine.espn_team_id || m.away_espn_team_id === mine.espn_team_id),
    );
    if (matchup) {
      const opponentTeamId =
        matchup.home_espn_team_id === mine.espn_team_id
          ? matchup.away_espn_team_id
          : matchup.home_espn_team_id;
      for (const r of bundle.rosterEntries) {
        if (r.espn_team_id !== opponentTeamId) continue;
        if (!isStarterSlot(r.lineup_slot)) continue;
        espnIds.add(r.espn_player_id);
      }
    }
  }

  const { data: userData } = await supabase.auth.getUser();
  const { data: watchlist } = userData.user
    ? await supabase
        .from("league_watchlist")
        .select("espn_player_id")
        .eq("league_id", leagueId)
        .eq("user_id", userData.user.id)
    : { data: [] };
  for (const w of watchlist ?? []) {
    if (w.espn_player_id != null) espnIds.add(Number(w.espn_player_id));
  }

  const allIds = [...espnIds];
  const { data: espnPlayers } =
    allIds.length > 0
      ? await supabase
          .from("espn_players")
          .select("espn_player_id, headshot_url, name, position, nfl_team")
          .in("espn_player_id", allIds)
      : { data: [] };

  const espnById = new Map(
    (espnPlayers ?? []).map((p) => [Number(p.espn_player_id), p]),
  );

  const rosterIds = new Set(rosterEntries.map((r) => r.espn_player_id));
  const opponentStarterIds = new Set<number>();
  if (week != null) {
    const matchup = bundle.matchups.find(
      (m) =>
        m.week === week &&
        (m.home_espn_team_id === mine.espn_team_id || m.away_espn_team_id === mine.espn_team_id),
    );
    if (matchup) {
      const opponentTeamId =
        matchup.home_espn_team_id === mine.espn_team_id
          ? matchup.away_espn_team_id
          : matchup.home_espn_team_id;
      for (const r of bundle.rosterEntries) {
        if (r.espn_team_id === opponentTeamId && isStarterSlot(r.lineup_slot)) {
          opponentStarterIds.add(r.espn_player_id);
        }
      }
    }
  }

  const watchlistIds = new Set((watchlist ?? []).map((w) => Number(w.espn_player_id)));

  const players: RosterPlayerForNews[] = [];

  function headshotFor(id: number, position: string, nflTeam: string | null, storedUrl?: string | null) {
    return resolveEspnImageUrl({
      espnPlayerId: id,
      position,
      nflTeam,
      storedUrl,
    });
  }

  for (const entry of rosterEntries) {
    const meta = espnById.get(entry.espn_player_id);
    players.push(
      mapEntryToPlayer(
        entry,
        headshotFor(
          entry.espn_player_id,
          entry.position,
          entry.nfl_team,
          meta?.headshot_url as string | null,
        ),
        "roster",
      ),
    );
  }

  for (const id of opponentStarterIds) {
    if (rosterIds.has(id)) continue;
    const entry = bundle.rosterEntries.find((r) => r.espn_player_id === id);
    const meta = espnById.get(id);
    if (!entry && !meta) continue;
    const position = String(entry?.position ?? meta?.position ?? "");
    const nflTeam = entry?.nfl_team ?? (meta?.nfl_team != null ? String(meta.nfl_team) : null);
    players.push(
      mapEntryToPlayer(
        entry ?? {
          espn_player_id: id,
          player_name: String(meta?.name ?? "Unknown"),
          position,
          nfl_team: nflTeam,
          lineup_slot: "FLEX",
          injury_status: null,
        },
        headshotFor(id, position, nflTeam, meta?.headshot_url as string | null),
        "opponent",
      ),
    );
  }

  for (const id of watchlistIds) {
    if (rosterIds.has(id) || opponentStarterIds.has(id)) continue;
    const meta = espnById.get(id);
    const poolEntry = bundle.rosterEntries.find((r) => r.espn_player_id === id);
    const position = String(poolEntry?.position ?? meta?.position ?? "");
    const nflTeam =
      poolEntry?.nfl_team ?? (meta?.nfl_team != null ? String(meta.nfl_team) : null);
    players.push(
      mapEntryToPlayer(
        poolEntry ?? {
          espn_player_id: id,
          player_name: String(meta?.name ?? "Unknown"),
          position,
          nfl_team: nflTeam,
          lineup_slot: "BENCH",
          injury_status: null,
        },
        headshotFor(id, position, nflTeam, meta?.headshot_url as string | null),
        "watchlist",
      ),
    );
  }

  const playersById = new Map(players.map((p) => [p.espnPlayerId, p]));

  const { data: deltas } = await supabase
    .from("league_injury_deltas")
    .select("espn_player_id, player_name, from_status, to_status, detected_at")
    .eq("league_id", leagueId)
    .eq("acknowledged", false)
    .order("detected_at", { ascending: false })
    .limit(50);

  const injuryDeltas: InjuryDeltaView[] = (deltas ?? []).map((d) => ({
    espnPlayerId: Number(d.espn_player_id),
    playerName: String(d.player_name),
    fromStatus: d.from_status != null ? String(d.from_status) : null,
    toStatus: String(d.to_status),
    detectedAt: String(d.detected_at),
  }));

  return {
    leagueId,
    lastSyncedAt: bundle.league.last_synced_at,
    currentWeek: bundle.league.current_week,
    players,
    playersById,
    injuryDeltas,
  };
}
