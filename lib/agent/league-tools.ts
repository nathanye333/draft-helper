import { tool } from "langchain";
import { z } from "zod";
import { createPlayerBoardTools } from "@/lib/agent/player-board-tools";
import { buildSeasonPlayerRows } from "@/lib/agent/player-query";
import { fetchFreeAgents, fetchLeagueBundle, rosterSlotsFromLeague, userTeam } from "@/lib/league/data";
import { fetchConsistencyByEspnIds } from "@/lib/league/consistency-data";
import {
  fetchDefenseMatchups,
  fetchOpponentForTeam,
  loadSeasonAnalysisRows,
} from "@/lib/league/season-analysis-data";
import {
  analyzeSeasonPlayers,
  SEASON_ANALYSIS_COLUMNS,
} from "@/lib/analytics/season-analysis";
import { summarizeConsistency } from "@/lib/analytics/consistency";
import { suggestStartSit } from "@/lib/analytics/start-sit";
import { evaluateTrade } from "@/lib/analytics/trade";
import { rankWaiverTargets } from "@/lib/analytics/waivers";
import { webSearch } from "@/lib/agent/web-search";
import { fetchRankingsBoard } from "@/lib/rankings/data";
import { normalizeNflTeam } from "@/lib/nflverse/matchups-sync";
import type { WorkingLineupEntry } from "@/lib/league/working-lineup";
import { isStarterSlot } from "@/lib/league/slot-order";
import type { ScoringFormat } from "@/lib/supabase/types";

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

async function loadSeasonPlayerRows(leagueId: string) {
  const bundle = await fetchLeagueBundle(leagueId);
  if (!bundle) throw new Error("League not found or you do not have access.");

  const rankings = await fetchRankingsBoard(bundle.league.season, bundle.league.scoring as ScoringFormat, {
    includeProjStats: true,
  });

  const teamNameByEspnId = new Map(bundle.teams.map((t) => [t.espn_team_id, t.name]));
  const rosteredByFpId = new Map<string, string>();
  for (const r of bundle.rosterEntries) {
    if (!r.fp_player_id) continue;
    rosteredByFpId.set(r.fp_player_id, teamNameByEspnId.get(r.espn_team_id) ?? "Rostered");
  }

  return buildSeasonPlayerRows(rankings, rosteredByFpId);
}

export function createLeagueTools(
  leagueId: string,
  options?: { workingLineup?: WorkingLineupEntry[] | null },
) {
  const workingLineup = options?.workingLineup ?? null;

  const boardTools = createPlayerBoardTools({
    loadRows: () => loadSeasonPlayerRows(leagueId),
    availabilityNote: "available = not on any roster in this league (free agent / waiver)",
  });

  const get_league_snapshot = tool(
    async () => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      const mine = userTeam(bundle);
      return json({
        name: bundle.league.name,
        season: bundle.league.season,
        scoring: bundle.league.scoring,
        currentWeek: bundle.league.current_week,
        lastSyncedAt: bundle.league.last_synced_at,
        myTeam: mine
          ? {
              espnTeamId: mine.espn_team_id,
              name: mine.name,
              record: `${mine.wins}-${mine.losses}-${mine.ties}`,
            }
          : null,
        teamCount: bundle.teams.length,
        rosterSlots: rosterSlotsFromLeague(bundle.league),
        matchupsThisWeek: bundle.matchups,
      });
    },
    {
      name: "get_league_snapshot",
      description: "League settings, your team, current week, matchups, roster slots.",
      schema: z.object({}),
    },
  );

  const get_my_roster = tool(
    async () => {
      if (workingLineup && workingLineup.length > 0) {
        const starterPts = workingLineup
          .filter((p) => isStarterSlot(p.slot))
          .reduce((sum, p) => sum + (p.weekProj ?? 0), 0);
        return json({
          source: "user_sandbox",
          note: "User is experimenting with a temporary Start/Sit arrangement (not saved to ESPN).",
          projectedStarterPoints: Number(starterPts.toFixed(2)),
          players: workingLineup.map((p) => ({
            espnPlayerId: p.espnPlayerId,
            name: p.name,
            position: p.position,
            nflTeam: p.nflTeam,
            slot: p.slot,
            injury: p.injuryStatus,
            weekProj: p.weekProj,
          })),
        });
      }
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      const mine = userTeam(bundle);
      if (!mine) return json({ error: "No user team marked" });
      const entries = bundle.rosterEntries
        .filter((r) => r.espn_team_id === mine.espn_team_id)
        .map((r) => ({
          espnPlayerId: r.espn_player_id,
          fpPlayerId: r.fp_player_id,
          name: r.player_name,
          position: r.position,
          nflTeam: r.nfl_team,
          slot: r.lineup_slot,
          injury: r.injury_status,
          weekProj: r.fp_player_id
            ? bundle.projectionsByFpId.get(r.fp_player_id)?.week ?? null
            : null,
          rosProj: r.fp_player_id
            ? bundle.projectionsByFpId.get(r.fp_player_id)?.ros ?? null
            : null,
        }));
      return json({ source: "espn_sync", team: mine.name, players: entries });
    },
    {
      name: "get_my_roster",
      description:
        "Your roster with lineup slots and week projections. Prefers the user's temporary Start/Sit sandbox arrangement when present.",
      schema: z.object({}),
    },
  );

  const get_team_roster = tool(
    async (input) => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      let team = input.espnTeamId
        ? bundle.teams.find((t) => t.espn_team_id === input.espnTeamId)
        : undefined;
      if (!team && input.teamName) {
        const needle = input.teamName.toLowerCase();
        team = bundle.teams.find((t) => t.name.toLowerCase().includes(needle));
      }
      if (!team) return json({ error: "Team not found", teams: bundle.teams.map((t) => t.name) });
      const players = bundle.rosterEntries
        .filter((r) => r.espn_team_id === team!.espn_team_id)
        .map((r) => ({
          espnPlayerId: r.espn_player_id,
          name: r.player_name,
          position: r.position,
          slot: r.lineup_slot,
          weekProj: r.fp_player_id
            ? bundle.projectionsByFpId.get(r.fp_player_id)?.week ?? null
            : null,
          rosProj: r.fp_player_id
            ? bundle.projectionsByFpId.get(r.fp_player_id)?.ros ?? null
            : null,
        }));
      return json({ team: { id: team.espn_team_id, name: team.name }, players });
    },
    {
      name: "get_team_roster",
      description: "Roster for any league team by ESPN team id or name.",
      schema: z.object({
        espnTeamId: z.number().int().optional(),
        teamName: z.string().optional(),
      }),
    },
  );

  const query_free_agents = tool(
    async (input) => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      let fas = await fetchFreeAgents({
        leagueId,
        season: bundle.league.season,
        scoring: bundle.league.scoring,
        week: bundle.league.current_week,
        limit: input.limit ?? 40,
      });
      if (input.position) {
        fas = fas.filter((f) => f.position === input.position);
      }
      return json({ count: fas.length, freeAgents: fas });
    },
    {
      name: "query_free_agents",
      description: "Unrostered players with week/ROS FantasyPros projections.",
      schema: z.object({
        position: z.enum(["QB", "RB", "WR", "TE", "K", "DST"]).optional(),
        limit: z.number().int().min(1).max(80).optional(),
      }),
    },
  );

  const suggest_start_sit = tool(
    async () => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      const mine = userTeam(bundle);
      if (!mine) return json({ error: "No user team" });
      const roster = bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id);
      const weekProj = new Map<string, number | null>();
      for (const [fp, v] of bundle.projectionsByFpId) weekProj.set(fp, v.week);
      const suggestion = suggestStartSit({
        roster,
        rosterSlots: rosterSlotsFromLeague(bundle.league),
        weekProjByFpId: weekProj,
      });
      const opp = bundle.matchups.find(
        (m) =>
          m.home_espn_team_id === mine.espn_team_id ||
          m.away_espn_team_id === mine.espn_team_id,
      );
      let opponentName: string | null = null;
      if (opp) {
        const oppId =
          opp.home_espn_team_id === mine.espn_team_id
            ? opp.away_espn_team_id
            : opp.home_espn_team_id;
        opponentName = bundle.teams.find((t) => t.espn_team_id === oppId)?.name ?? null;
      }

      const focusIds = [
        ...suggestion.starters.map((p) => p.espnPlayerId),
        ...suggestion.bench.slice(0, 6).map((p) => p.espnPlayerId),
      ];
      const consistencyById = await fetchConsistencyByEspnIds({
        leagueId,
        season: bundle.league.season,
        espnPlayerIds: focusIds,
      });
      const notes = [...suggestion.notes];
      for (const p of suggestion.starters) {
        const c = consistencyById.get(p.espnPlayerId);
        if (!c || c.games < 3) continue;
        if (c.label === "volatile" || c.label === "boom_bust") {
          notes.push(
            `${p.name} is a ${c.label.replace("_", "/")} starter (${summarizeConsistency(p.name, c)}).`,
          );
        }
      }
      for (const p of suggestion.bench.slice(0, 4)) {
        const c = consistencyById.get(p.espnPlayerId);
        if (!c || c.games < 3) continue;
        if (c.label === "consistent" && (p.weekProj ?? 0) >= 8) {
          notes.push(
            `Bench option ${p.name} has been relatively consistent — consider if chasing boom/bust starters.`,
          );
        }
      }

      const withConsistency = {
        starters: suggestion.starters.map((p) => ({
          ...p,
          consistency: consistencyById.get(p.espnPlayerId) ?? null,
        })),
        bench: suggestion.bench.map((p) => ({
          ...p,
          consistency: consistencyById.get(p.espnPlayerId) ?? null,
        })),
      };

      return json({
        week: bundle.league.current_week,
        opponentName,
        projectedStarterPoints: suggestion.projectedStarterPoints,
        notes,
        ...withConsistency,
      });
    },
    {
      name: "suggest_start_sit",
      description:
        "Recommended starters/bench from weekly projections and roster slots, with ESPN weekly consistency stats attached.",
      schema: z.object({}),
    },
  );

  const evaluate_trade = tool(
    async (input) => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      const mine = userTeam(bundle);
      if (!mine) return json({ error: "No user team" });

      const theirTeam = bundle.teams.find((t) => t.espn_team_id === input.theirEspnTeamId);
      if (!theirTeam) return json({ error: "Opponent team not found" });

      const allIds = [...input.giveEspnPlayerIds, ...input.getEspnPlayerIds];
      const consistencyById = await fetchConsistencyByEspnIds({
        leagueId,
        season: bundle.league.season,
        espnPlayerIds: allIds,
      });

      const toPlayer = (espnPlayerId: number) => {
        const row = bundle.rosterEntries.find((r) => r.espn_player_id === espnPlayerId);
        if (!row) return null;
        const proj = row.fp_player_id ? bundle.projectionsByFpId.get(row.fp_player_id) : undefined;
        return {
          espnPlayerId: row.espn_player_id,
          name: row.player_name,
          position: row.position,
          rosProj: proj?.ros ?? null,
          weekProj: proj?.week ?? null,
          consistency: consistencyById.get(espnPlayerId) ?? null,
        };
      };

      const give = input.giveEspnPlayerIds.map(toPlayer).filter(Boolean);
      const get = input.getEspnPlayerIds.map(toPlayer).filter(Boolean);
      if (give.length !== input.giveEspnPlayerIds.length || get.length !== input.getEspnPlayerIds.length) {
        return json({ error: "One or more player IDs not found on league rosters" });
      }

      const evaluation = evaluateTrade({
        yourRoster: bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id),
        theirRoster: bundle.rosterEntries.filter((r) => r.espn_team_id === theirTeam.espn_team_id),
        give: give as NonNullable<(typeof give)[number]>[],
        get: get as NonNullable<(typeof get)[number]>[],
        yourEspnTeamId: mine.espn_team_id,
        theirEspnTeamId: theirTeam.espn_team_id,
        rosterSlots: rosterSlotsFromLeague(bundle.league),
      });
      return json(evaluation);
    },
    {
      name: "evaluate_trade",
      description:
        "Evaluate a trade: giveEspnPlayerIds (your players) vs getEspnPlayerIds from theirEspnTeamId. Includes ROS/week projections, need, and weekly consistency from ESPN actuals.",
      schema: z.object({
        theirEspnTeamId: z.number().int(),
        giveEspnPlayerIds: z.array(z.number().int()).min(1).max(6),
        getEspnPlayerIds: z.array(z.number().int()).min(1).max(6),
      }),
    },
  );

  const player_consistency = tool(
    async (input) => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });

      let espnIds = input.espnPlayerIds ?? [];
      if (espnIds.length === 0 && input.names && input.names.length > 0) {
        const found: number[] = [];
        for (const name of input.names) {
          const needle = name.trim().toLowerCase();
          const row = bundle.rosterEntries.find((r) =>
            r.player_name.toLowerCase().includes(needle),
          );
          if (row) found.push(row.espn_player_id);
        }
        espnIds = found;
      }
      if (espnIds.length === 0) {
        return json({
          error: "Provide espnPlayerIds or names that match league roster players",
        });
      }

      const consistencyById = await fetchConsistencyByEspnIds({
        leagueId,
        season: bundle.league.season,
        espnPlayerIds: espnIds,
      });

      const players = espnIds.map((id) => {
        const row = bundle.rosterEntries.find((r) => r.espn_player_id === id);
        const stats = consistencyById.get(id)!;
        return {
          espnPlayerId: id,
          name: row?.player_name ?? `espn:${id}`,
          position: row?.position ?? null,
          team: row
            ? bundle.teams.find((t) => t.espn_team_id === row.espn_team_id)?.name ?? null
            : null,
          season: bundle.league.season,
          consistency: stats,
          summary: summarizeConsistency(row?.player_name ?? `espn:${id}`, stats),
        };
      });

      return json({
        note: "Stats from ESPN weekly actual fantasy points (week≥1). Uses current season; pads with prior season if <3 games.",
        players,
      });
    },
    {
      name: "player_consistency",
      description:
        "Weekly fantasy-point consistency (mean, σ, CV, floor/ceiling, boom/bust rates) from ESPN actuals for roster players by espnPlayerIds or name.",
      schema: z.object({
        espnPlayerIds: z.array(z.number().int()).min(1).max(12).optional(),
        names: z.array(z.string()).min(1).max(12).optional(),
      }),
    },
  );

  const analyze_season_players = tool(
    async (input) => {
      const { season, rows } = await loadSeasonAnalysisRows(leagueId);
      if (rows.length === 0) {
        return json({
          error: "No roster/week-point data. Sync ESPN so weekly actuals populate.",
          season,
        });
      }
      const result = analyzeSeasonPlayers(rows, {
        position: input.position,
        availableOnly: input.availableOnly,
        nameContains: input.nameContains,
        minGames: input.minGames,
        minMean: input.minMean,
        maxCv: input.maxCv,
        orderBy: input.orderBy,
        orderDir: input.orderDir,
        limit: input.limit,
      });
      return json({
        season,
        note: "consistencyScore = mean / stdev (higher = productive and steady). availableOnly = not on your roster. Sync ESPN for weekly actuals.",
        columns: SEASON_ANALYSIS_COLUMNS,
        count: result.length,
        players: result,
      });
    },
    {
      name: "analyze_season_players",
      description:
        "Free filter/sort analysis over league-rostered players with ESPN weekly actuals: mean, σ, CV, consistencyScore (mean/σ), floor/ceiling, boom/bust, week/ROS proj. Use for questions like 'most consistent high scorers' (orderBy consistencyScore).",
      schema: z.object({
        position: z.enum(["QB", "RB", "WR", "TE", "K", "DST"]).optional(),
        availableOnly: z
          .boolean()
          .optional()
          .describe("If true, only players not on your team"),
        nameContains: z.string().optional(),
        minGames: z.number().int().min(1).max(18).optional(),
        minMean: z.number().optional(),
        maxCv: z.number().optional().describe("Max coefficient of variation (lower = steadier)"),
        orderBy: z.enum(SEASON_ANALYSIS_COLUMNS).optional().default("consistencyScore"),
        orderDir: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(80).optional().default(25),
      }),
    },
  );

  const query_defense_matchups = tool(
    async (input) => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      const season = input.season ?? bundle.league.season;
      const rows = await fetchDefenseMatchups({
        season,
        position: input.position,
        defenseTeam: input.defenseTeam
          ? normalizeNflTeam(input.defenseTeam) ?? input.defenseTeam
          : undefined,
        orderBy: input.orderBy,
        orderDir: input.orderDir,
        limit: input.limit ?? 32,
      });
      if (rows.length === 0) {
        return json({
          error:
            "No defense matchup data. Sync NFL matchups (nflverse) for this league season.",
          season,
        });
      }
      return json({
        season,
        note: "fant_pts_avg = fantasy pts allowed/game to that position (higher = softer). rush_ypc_vs_avg = defense rush YPC allowed minus league avg (negative = stingier vs the run).",
        count: rows.length,
        defenses: rows,
      });
    },
    {
      name: "query_defense_matchups",
      description:
        "NFL defense vs position board: fantasy points allowed, rush YPC allowed, YPC vs league average, ranks. E.g. how RBs fare vs SEA.",
      schema: z.object({
        position: z.enum(["QB", "RB", "WR", "TE"]).optional(),
        defenseTeam: z.string().optional().describe("NFL team abbr, e.g. SEA"),
        season: z.number().int().optional(),
        orderBy: z
          .enum(["fant_pts_avg", "fant_pts_ppr_avg", "rush_ypc", "rush_ypc_vs_avg", "fant_pts_rank"])
          .optional(),
        orderDir: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(40).optional(),
      }),
    },
  );

  const get_player_matchup = tool(
    async (input) => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      const week =
        input.week ??
        (bundle.league.current_week && bundle.league.current_week > 0
          ? bundle.league.current_week
          : 1);

      let espnId = input.espnPlayerId;
      if (espnId == null && input.name) {
        const needle = input.name.trim().toLowerCase();
        espnId = bundle.rosterEntries.find((r) =>
          r.player_name.toLowerCase().includes(needle),
        )?.espn_player_id;
      }
      if (espnId == null) return json({ error: "Player not found on league rosters" });

      const row = bundle.rosterEntries.find((r) => r.espn_player_id === espnId);
      if (!row) return json({ error: "Player not found" });
      const nflTeam = normalizeNflTeam(row.nfl_team);
      if (!nflTeam) return json({ error: "Player has no NFL team", player: row.player_name });

      const position = ["QB", "RB", "WR", "TE"].includes(row.position)
        ? row.position
        : null;
      if (!position) {
        return json({
          error: `Matchup board is for QB/RB/WR/TE (got ${row.position})`,
          player: row.player_name,
        });
      }

      const opp = await fetchOpponentForTeam({
        season: bundle.league.season,
        week,
        nflTeam,
      });
      if (!opp) {
        return json({
          error: "No schedule opponent found — sync NFL matchups / check week",
          player: row.player_name,
          nflTeam,
          week,
        });
      }

      const defenses = await fetchDefenseMatchups({
        season: bundle.league.season,
        position,
        defenseTeam: opp.opponent,
        limit: 1,
      });
      const defense = defenses[0] ?? null;

      return json({
        player: {
          espnPlayerId: row.espn_player_id,
          name: row.player_name,
          position,
          nflTeam,
        },
        week,
        opponent: opp.opponent,
        home: opp.home,
        defenseVsPosition: defense,
        note: defense
          ? `Vs ${opp.opponent}: ${position}s avg ${defense.fant_pts_avg} FPTS/g (rank ${defense.fant_pts_rank}; 1=softest). Rush YPC allowed ${defense.rush_ypc} (Δ vs avg ${defense.rush_ypc_vs_avg}).`
          : "Opponent found but no defense-vs-position row — sync NFL matchups.",
      });
    },
    {
      name: "get_player_matchup",
      description:
        "This week's NFL opponent and defense-vs-position stats for a roster player (by name or espnPlayerId).",
      schema: z.object({
        espnPlayerId: z.number().int().optional(),
        name: z.string().optional(),
        week: z.number().int().min(1).max(22).optional(),
      }),
    },
  );

  const waiver_targets = tool(
    async (input) => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      const mine = userTeam(bundle);
      if (!mine) return json({ error: "No user team" });
      const fas = await fetchFreeAgents({
        leagueId,
        season: bundle.league.season,
        scoring: bundle.league.scoring,
        week: bundle.league.current_week,
        limit: 120,
      });
      const targets = rankWaiverTargets({
        freeAgents: fas,
        yourRoster: bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id),
        rosterSlots: rosterSlotsFromLeague(bundle.league),
        limit: input.limit ?? 15,
      });
      return json({ targets });
    },
    {
      name: "waiver_targets",
      description: "Rank free agents by weekly/ROS projections and your positional need.",
      schema: z.object({
        limit: z.number().int().min(1).max(40).optional(),
      }),
    },
  );

  const list_teams = tool(
    async () => {
      const bundle = await fetchLeagueBundle(leagueId);
      if (!bundle) return json({ error: "League not found" });
      return json({
        teams: bundle.teams.map((t) => ({
          espnTeamId: t.espn_team_id,
          name: t.name,
          record: `${t.wins}-${t.losses}-${t.ties}`,
          isUserTeam: t.is_user_team,
        })),
      });
    },
    {
      name: "list_teams",
      description: "List all fantasy teams in the league.",
      schema: z.object({}),
    },
  );

  const web_search = tool(
    async (input) => {
      const result = await webSearch(input.query, { maxResults: input.maxResults ?? 5 });
      return JSON.stringify({
        query: result.query,
        provider: result.provider,
        results: result.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet.slice(0, 240),
        })),
      });
    },
    {
      name: "web_search",
      description: "Search news/injuries. Prefer league tools for roster/projection numbers.",
      schema: z.object({
        query: z.string(),
        maxResults: z.number().int().min(1).max(8).optional(),
      }),
    },
  );

  return [
    ...boardTools,
    get_league_snapshot,
    get_my_roster,
    get_team_roster,
    list_teams,
    query_free_agents,
    suggest_start_sit,
    evaluate_trade,
    player_consistency,
    analyze_season_players,
    query_defense_matchups,
    get_player_matchup,
    waiver_targets,
    web_search,
  ];
}
