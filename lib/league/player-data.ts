import { createClient } from "@/lib/supabase/server";
import type {
  EspnPlayer,
  EspnPlayerWeekPoints,
  LeaguePlayerPoolRow,
  LeagueTeam,
} from "@/lib/supabase/types";

export interface PlayerCardData {
  player: EspnPlayer;
  pool: LeaguePlayerPoolRow | null;
  fantasyTeam: LeagueTeam | null;
  ownershipLabel: string;
  thisYearWeeks: EspnPlayerWeekPoints[];
  lastYearWeeks: EspnPlayerWeekPoints[];
  fpWeekProj: number | null;
  fpRosProj: number | null;
}

export async function fetchPlayerCard(
  leagueId: string,
  espnPlayerId: number,
): Promise<PlayerCardData | null> {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("season, scoring, current_week")
    .eq("id", leagueId)
    .single();
  if (!league) return null;

  const [{ data: player }, { data: pool }, { data: weekPoints }] = await Promise.all([
    supabase.from("espn_players").select("*").eq("espn_player_id", espnPlayerId).maybeSingle(),
    supabase
      .from("league_player_pool")
      .select("*")
      .eq("league_id", leagueId)
      .eq("espn_player_id", espnPlayerId)
      .maybeSingle(),
    supabase
      .from("espn_player_week_points")
      .select("*")
      .eq("league_id", leagueId)
      .eq("espn_player_id", espnPlayerId)
      .in("season", [league.season, league.season - 1])
      .order("week", { ascending: true }),
  ]);

  // Fallback player row from roster if pool sync hasn't run yet.
  let resolvedPlayer = player as EspnPlayer | null;
  if (!resolvedPlayer) {
    const { data: roster } = await supabase
      .from("league_roster_entries")
      .select("player_name, position, nfl_team")
      .eq("league_id", leagueId)
      .eq("espn_player_id", espnPlayerId)
      .maybeSingle();
    if (!roster) return null;
    resolvedPlayer = {
      espn_player_id: espnPlayerId,
      name: roster.player_name,
      position: roster.position,
      nfl_team: roster.nfl_team,
      headshot_url: `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnPlayerId}.png&w=350&h=254`,
      updated_at: new Date().toISOString(),
    };
  }

  let fantasyTeam: LeagueTeam | null = null;
  const poolRow = pool as LeaguePlayerPoolRow | null;
  if (poolRow?.espn_team_id != null) {
    const { data: team } = await supabase
      .from("league_teams")
      .select("*")
      .eq("league_id", leagueId)
      .eq("espn_team_id", poolRow.espn_team_id)
      .maybeSingle();
    fantasyTeam = (team as LeagueTeam) ?? null;
  } else {
    const { data: roster } = await supabase
      .from("league_roster_entries")
      .select("espn_team_id")
      .eq("league_id", leagueId)
      .eq("espn_player_id", espnPlayerId)
      .maybeSingle();
    if (roster) {
      const { data: team } = await supabase
        .from("league_teams")
        .select("*")
        .eq("league_id", leagueId)
        .eq("espn_team_id", roster.espn_team_id)
        .maybeSingle();
      fantasyTeam = (team as LeagueTeam) ?? null;
    }
  }

  const ownership = poolRow?.ownership;
  let ownershipLabel = "Free agent / unrostered";
  if (fantasyTeam) ownershipLabel = fantasyTeam.name;
  else if (ownership === "WAIVERS") ownershipLabel = "Waivers";
  else if (ownership === "FREEAGENT") ownershipLabel = "Free agent";

  const weeks = (weekPoints ?? []) as EspnPlayerWeekPoints[];
  const thisYearWeeks = weeks.filter((w) => w.season === league.season && w.week > 0);
  const lastYearWeeks = weeks.filter((w) => w.season === league.season - 1 && w.week > 0);

  let fpWeekProj: number | null = null;
  let fpRosProj: number | null = null;
  if (poolRow?.fp_player_id) {
    const week = league.current_week && league.current_week > 0 ? league.current_week : null;
    const weekFilter = week != null ? [0, week] : [0];
    const { data: projs } = await supabase
      .from("player_projections_weekly")
      .select("week, proj_points")
      .eq("fp_player_id", poolRow.fp_player_id)
      .eq("season", league.season)
      .eq("scoring", league.scoring)
      .in("week", weekFilter);
    for (const p of projs ?? []) {
      if (p.week === 0) fpRosProj = p.proj_points;
      else fpWeekProj = p.proj_points;
    }
  }

  return {
    player: resolvedPlayer,
    pool: poolRow,
    fantasyTeam,
    ownershipLabel,
    thisYearWeeks,
    lastYearWeeks,
    fpWeekProj,
    fpRosProj,
  };
}

export async function fetchTeamRosterPage(leagueId: string, espnTeamId: number) {
  const supabase = await createClient();
  const [{ data: team }, { data: league }] = await Promise.all([
    supabase
      .from("league_teams")
      .select("*")
      .eq("league_id", leagueId)
      .eq("espn_team_id", espnTeamId)
      .maybeSingle(),
    supabase.from("leagues").select("current_week").eq("id", leagueId).single(),
  ]);
  if (!team) return null;

  const { data: roster } = await supabase
    .from("league_roster_entries")
    .select("*")
    .eq("league_id", leagueId)
    .eq("espn_team_id", espnTeamId);

  const ids = (roster ?? []).map((r) => r.espn_player_id as number);
  const { data: pool } =
    ids.length > 0
      ? await supabase
          .from("league_player_pool")
          .select("*")
          .eq("league_id", leagueId)
          .in("espn_player_id", ids)
      : { data: [] };

  const poolById = new Map((pool ?? []).map((p) => [p.espn_player_id as number, p]));
  const { data: espnPlayers } =
    ids.length > 0
      ? await supabase.from("espn_players").select("*").in("espn_player_id", ids)
      : { data: [] };
  const headshots = new Map(
    (espnPlayers ?? []).map((p) => [p.espn_player_id as number, p.headshot_url as string | null]),
  );

  return {
    team: team as LeagueTeam,
    currentWeek: (league?.current_week as number | null) ?? null,
    players: (roster ?? []).map((r) => {
      const p = poolById.get(r.espn_player_id);
      return {
        espnPlayerId: r.espn_player_id as number,
        name: r.player_name as string,
        position: r.position as string,
        nflTeam: r.nfl_team as string | null,
        lineupSlot: r.lineup_slot as string,
        injuryStatus: r.injury_status as string | null,
        headshotUrl: headshots.get(r.espn_player_id) ?? null,
        weekProjected: (p?.week_projected as number | null) ?? null,
        weekActual: (p?.week_actual as number | null) ?? null,
        seasonProjected: (p?.season_projected as number | null) ?? null,
        seasonActual: (p?.season_actual as number | null) ?? null,
        percentOwned: (p?.percent_owned as number | null) ?? null,
      };
    }),
  };
}

export async function fetchWaiverPool(leagueId: string) {
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("current_week, season, scoring")
    .eq("id", leagueId)
    .single();

  const { data: rows } = await supabase
    .from("league_player_pool")
    .select("*, espn_players(name, position, nfl_team, headshot_url)")
    .eq("league_id", leagueId)
    .in("ownership", ["FREEAGENT", "WAIVERS"])
    .order("week_projected", { ascending: false });

  type Row = LeaguePlayerPoolRow & {
    espn_players:
      | { name: string; position: string; nfl_team: string | null; headshot_url: string | null }
      | { name: string; position: string; nfl_team: string | null; headshot_url: string | null }[]
      | null;
  };

  const players = ((rows ?? []) as Row[]).map((r) => {
    const ep = Array.isArray(r.espn_players) ? r.espn_players[0] : r.espn_players;
    return {
      espnPlayerId: r.espn_player_id,
      name: ep?.name ?? `Player ${r.espn_player_id}`,
      position: ep?.position ?? "UNK",
      nflTeam: ep?.nfl_team ?? null,
      headshotUrl: ep?.headshot_url ?? null,
      ownership: r.ownership,
      percentOwned: r.percent_owned,
      weekProjected: r.week_projected,
      weekActual: r.week_actual,
      seasonProjected: r.season_projected,
      seasonActual: r.season_actual,
      injuryStatus: r.injury_status,
    };
  });

  return {
    currentWeek: league?.current_week ?? null,
    season: league?.season ?? null,
    scoring: league?.scoring ?? null,
    players,
  };
}
