import { createClient } from "@/lib/supabase/server";
import {
  buildSeasonAnalysisRow,
  type SeasonAnalysisRow,
} from "@/lib/analytics/season-analysis";
import { fetchLeagueBundle, userTeam } from "@/lib/league/data";
import type { ScoringFormat } from "@/lib/supabase/types";

/**
 * Build season analysis rows for all rostered players (+ optionally pool)
 * with ESPN weekly actuals and FantasyPros projections.
 */
export async function loadSeasonAnalysisRows(leagueId: string): Promise<{
  season: number;
  scoring: ScoringFormat;
  rows: SeasonAnalysisRow[];
}> {
  const bundle = await fetchLeagueBundle(leagueId);
  if (!bundle) throw new Error("League not found");

  const supabase = await createClient();
  const season = bundle.league.season;
  const scoring = bundle.league.scoring as ScoringFormat;

  const teamNameByEspn = new Map(bundle.teams.map((t) => [t.espn_team_id, t.name]));
  const rostered = bundle.rosterEntries;

  const espnIds = [...new Set(rostered.map((r) => r.espn_player_id))];
  if (espnIds.length === 0) {
    return { season, scoring, rows: [] };
  }

  const { data: weekPoints, error } = await supabase
    .from("espn_player_week_points")
    .select("espn_player_id, season, week, actual_points")
    .eq("league_id", leagueId)
    .in("espn_player_id", espnIds)
    .in("season", [season, season - 1])
    .gte("week", 1)
    .not("actual_points", "is", null);

  if (error) throw new Error(error.message);

  const actualsById = new Map<number, { season: number; actual: number }[]>();
  for (const row of weekPoints ?? []) {
    const id = Number(row.espn_player_id);
    const list = actualsById.get(id) ?? [];
    list.push({ season: Number(row.season), actual: Number(row.actual_points) });
    actualsById.set(id, list);
  }

  const mine = userTeam(bundle);
  const rows: SeasonAnalysisRow[] = rostered.map((r) => {
    const samples = actualsById.get(r.espn_player_id) ?? [];
    const current = samples.filter((s) => s.season === season).map((s) => s.actual);
    const weekActuals =
      current.length >= 3
        ? current
        : [...current, ...samples.filter((s) => s.season === season - 1).map((s) => s.actual)];
    const proj = r.fp_player_id ? bundle.projectionsByFpId.get(r.fp_player_id) : undefined;
    return buildSeasonAnalysisRow({
      espnPlayerId: r.espn_player_id,
      name: r.player_name,
      position: r.position,
      nflTeam: r.nfl_team,
      fantasyTeam: teamNameByEspn.get(r.espn_team_id) ?? null,
      // "available" here = not on the user's team (other-roster / trade-board filter).
      available: mine ? r.espn_team_id !== mine.espn_team_id : true,
      weekActuals,
      weekProj: proj?.week ?? null,
      rosProj: proj?.ros ?? null,
    });
  });

  // Deduplicate by espn id (keep first)
  const seen = new Set<number>();
  const deduped = rows.filter((r) => {
    if (seen.has(r.espnPlayerId)) return false;
    seen.add(r.espnPlayerId);
    return true;
  });

  return { season, scoring, rows: deduped };
}

export async function fetchDefenseMatchups(params: {
  season: number;
  position?: string;
  defenseTeam?: string;
  limit?: number;
  orderBy?: "fant_pts_avg" | "fant_pts_ppr_avg" | "rush_ypc" | "rush_ypc_vs_avg" | "fant_pts_rank";
  orderDir?: "asc" | "desc";
}) {
  const supabase = await createClient();
  let q = supabase.from("nfl_defense_vs_position").select("*").eq("season", params.season);

  if (params.position) q = q.eq("position", params.position.toUpperCase());
  if (params.defenseTeam) q = q.eq("defense_team", params.defenseTeam.toUpperCase());

  const orderBy = params.orderBy ?? "fant_pts_avg";
  const ascending = (params.orderDir ?? "desc") === "asc";
  q = q.order(orderBy, { ascending, nullsFirst: false }).limit(params.limit ?? 32);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchOpponentForTeam(params: {
  season: number;
  week: number;
  nflTeam: string;
}): Promise<{ opponent: string; home: boolean } | null> {
  const supabase = await createClient();
  const team = params.nflTeam.toUpperCase();
  const { data, error } = await supabase
    .from("nfl_schedule_games")
    .select("home_team, away_team")
    .eq("season", params.season)
    .eq("week", params.week)
    .or(`home_team.eq.${team},away_team.eq.${team}`)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.home_team === team) return { opponent: data.away_team, home: true };
  return { opponent: data.home_team, home: false };
}
