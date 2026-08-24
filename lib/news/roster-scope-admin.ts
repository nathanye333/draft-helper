import { createAdminClient } from "@/lib/supabase/admin";
import { isStarterSlot } from "@/lib/league/slot-order";
import { resolveEspnImageUrl } from "@/lib/espn/player-universe";
import type { InjuryDeltaView, RosterPlayerForNews } from "@/lib/news/types";
import type { RosterScopeResult } from "@/lib/news/roster-scope";

/**
 * Cookie-free roster scope for cron / service-role jobs.
 * Loads the league owner's team, watchlist, opponent starters, and open injury deltas.
 */
export async function loadRosterScopeAdmin(
  leagueId: string,
  userId: string,
): Promise<RosterScopeResult | null> {
  const supabase = createAdminClient();

  const { data: league } = await supabase.from("leagues").select("*").eq("id", leagueId).maybeSingle();
  if (!league) return null;

  const [{ data: teams }, { data: rosterEntries }, { data: matchups }, { data: watchlist }] =
    await Promise.all([
      supabase.from("league_teams").select("*").eq("league_id", leagueId),
      supabase.from("league_roster_entries").select("*").eq("league_id", leagueId),
      supabase.from("league_matchups").select("*").eq("league_id", leagueId),
      supabase
        .from("league_watchlist")
        .select("espn_player_id")
        .eq("league_id", leagueId)
        .eq("user_id", userId),
    ]);

  const mine = (teams ?? []).find((t) => t.is_user_team) ?? (teams ?? [])[0];

  if (!mine) {
    return {
      leagueId,
      lastSyncedAt: league.last_synced_at != null ? String(league.last_synced_at) : null,
      currentWeek: league.current_week != null ? Number(league.current_week) : null,
      players: [],
      playersById: new Map(),
      injuryDeltas: [],
    };
  }

  const myTeamId = Number(mine.espn_team_id);
  const myRoster = (rosterEntries ?? []).filter((r) => Number(r.espn_team_id) === myTeamId);
  const espnIds = new Set<number>(myRoster.map((r) => Number(r.espn_player_id)));

  const week =
    league.current_week && Number(league.current_week) > 0 ? Number(league.current_week) : null;

  const opponentStarterIds = new Set<number>();
  if (week != null) {
    const matchup = (matchups ?? []).find(
      (m) =>
        Number(m.week) === week &&
        (Number(m.home_espn_team_id) === myTeamId || Number(m.away_espn_team_id) === myTeamId),
    );
    if (matchup) {
      const opponentTeamId =
        Number(matchup.home_espn_team_id) === myTeamId
          ? Number(matchup.away_espn_team_id)
          : Number(matchup.home_espn_team_id);
      for (const r of rosterEntries ?? []) {
        if (Number(r.espn_team_id) === opponentTeamId && isStarterSlot(String(r.lineup_slot))) {
          opponentStarterIds.add(Number(r.espn_player_id));
          espnIds.add(Number(r.espn_player_id));
        }
      }
    }
  }

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

  const espnById = new Map((espnPlayers ?? []).map((p) => [Number(p.espn_player_id), p]));
  const rosterIds = new Set(myRoster.map((r) => Number(r.espn_player_id)));
  const watchlistIds = new Set((watchlist ?? []).map((w) => Number(w.espn_player_id)));

  const players: RosterPlayerForNews[] = [];

  function mapEntry(
    entry: {
      espn_player_id: number;
      player_name: string;
      position: string;
      nfl_team: string | null;
      lineup_slot: string;
      injury_status: string | null;
    },
    scope: RosterPlayerForNews["scope"],
  ): RosterPlayerForNews {
    const id = Number(entry.espn_player_id);
    const meta = espnById.get(id);
    return {
      espnPlayerId: id,
      name: String(entry.player_name),
      position: String(entry.position),
      nflTeam: entry.nfl_team != null ? String(entry.nfl_team) : null,
      lineupSlot: String(entry.lineup_slot),
      injuryStatus: entry.injury_status != null ? String(entry.injury_status) : null,
      headshotUrl: resolveEspnImageUrl({
        espnPlayerId: id,
        position: String(entry.position),
        nflTeam: entry.nfl_team != null ? String(entry.nfl_team) : null,
        storedUrl: (meta?.headshot_url as string | null) ?? null,
      }),
      isStarter: isStarterSlot(String(entry.lineup_slot)),
      scope,
    };
  }

  for (const entry of myRoster) {
    players.push(
      mapEntry(
        {
          espn_player_id: Number(entry.espn_player_id),
          player_name: String(entry.player_name),
          position: String(entry.position),
          nfl_team: entry.nfl_team != null ? String(entry.nfl_team) : null,
          lineup_slot: String(entry.lineup_slot),
          injury_status: entry.injury_status != null ? String(entry.injury_status) : null,
        },
        "roster",
      ),
    );
  }

  for (const id of opponentStarterIds) {
    if (rosterIds.has(id)) continue;
    const entry = (rosterEntries ?? []).find((r) => Number(r.espn_player_id) === id);
    const meta = espnById.get(id);
    if (!entry && !meta) continue;
    players.push(
      mapEntry(
        {
          espn_player_id: id,
          player_name: String(entry?.player_name ?? meta?.name ?? "Unknown"),
          position: String(entry?.position ?? meta?.position ?? ""),
          nfl_team:
            entry?.nfl_team != null
              ? String(entry.nfl_team)
              : meta?.nfl_team != null
                ? String(meta.nfl_team)
                : null,
          lineup_slot: String(entry?.lineup_slot ?? "FLEX"),
          injury_status: entry?.injury_status != null ? String(entry.injury_status) : null,
        },
        "opponent",
      ),
    );
  }

  for (const id of watchlistIds) {
    if (rosterIds.has(id) || opponentStarterIds.has(id)) continue;
    const entry = (rosterEntries ?? []).find((r) => Number(r.espn_player_id) === id);
    const meta = espnById.get(id);
    players.push(
      mapEntry(
        {
          espn_player_id: id,
          player_name: String(entry?.player_name ?? meta?.name ?? "Unknown"),
          position: String(entry?.position ?? meta?.position ?? ""),
          nfl_team:
            entry?.nfl_team != null
              ? String(entry.nfl_team)
              : meta?.nfl_team != null
                ? String(meta.nfl_team)
                : null,
          lineup_slot: String(entry?.lineup_slot ?? "BENCH"),
          injury_status: entry?.injury_status != null ? String(entry.injury_status) : null,
        },
        "watchlist",
      ),
    );
  }

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
    lastSyncedAt: league.last_synced_at != null ? String(league.last_synced_at) : null,
    currentWeek: league.current_week != null ? Number(league.current_week) : null,
    players,
    playersById: new Map(players.map((p) => [p.espnPlayerId, p])),
    injuryDeltas,
  };
}
