import { tool } from "langchain";
import { z } from "zod";
import { fetchFreeAgents, fetchLeagueBundle, rosterSlotsFromLeague, userTeam } from "@/lib/league/data";
import { suggestStartSit } from "@/lib/analytics/start-sit";
import { evaluateTrade } from "@/lib/analytics/trade";
import { rankWaiverTargets } from "@/lib/analytics/waivers";
import { webSearch } from "@/lib/agent/web-search";
import type { WorkingLineupEntry } from "@/lib/league/working-lineup";
import { isStarterSlot } from "@/lib/league/slot-order";

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function createLeagueTools(
  leagueId: string,
  options?: { workingLineup?: WorkingLineupEntry[] | null },
) {
  const workingLineup = options?.workingLineup ?? null;

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
      return json({ week: bundle.league.current_week, opponentName, ...suggestion });
    },
    {
      name: "suggest_start_sit",
      description: "Recommended starters/bench from weekly projections and roster slots.",
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
        "Evaluate a trade: giveEspnPlayerIds (your players) vs getEspnPlayerIds from theirEspnTeamId.",
      schema: z.object({
        theirEspnTeamId: z.number().int(),
        giveEspnPlayerIds: z.array(z.number().int()).min(1).max(6),
        getEspnPlayerIds: z.array(z.number().int()).min(1).max(6),
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
    get_league_snapshot,
    get_my_roster,
    get_team_roster,
    list_teams,
    query_free_agents,
    suggest_start_sit,
    evaluate_trade,
    waiver_targets,
    web_search,
  ];
}
