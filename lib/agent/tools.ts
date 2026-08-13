import { tool } from "langchain";
import { search, SafeSearchType } from "duck-duck-scrape";
import { z } from "zod";
import { computeRecommendations } from "@/lib/analytics/recommendations";
import { computePositionScarcity } from "@/lib/analytics/scarcity";
import { fetchDraftBundle, type DraftBundle } from "@/lib/draft/data";
import { computeDraftState, toAvailablePlayerVMs } from "@/lib/draft/view";
import {
  aggregatePlayers,
  analyzeTeamRoster,
  buildPlayerRows,
  DATASET_COLUMNS,
  findPlayersByNameOrId,
  findValuePlays,
  getDraftSnapshot,
  PLAYER_SORT_COLUMNS,
  queryPlayers,
  type PlayerRow,
} from "@/lib/agent/player-query";
import type { Position } from "@/lib/supabase/types";

const positionSchema = z.enum(["QB", "RB", "WR", "TE", "K", "DST"]);
const orderBySchema = z.enum(PLAYER_SORT_COLUMNS);

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

async function loadContext(draftId: string): Promise<{
  bundle: DraftBundle;
  rows: PlayerRow[];
}> {
  const bundle = await fetchDraftBundle(draftId, { includeProjStats: true });
  if (!bundle) {
    throw new Error("Draft not found or you do not have access.");
  }
  return { bundle, rows: buildPlayerRows(bundle) };
}

/**
 * Read-only LangChain tools scoped to one draft. Bundle is loaded per tool
 * call via RLS-backed fetchDraftBundle (no admin client).
 */
export function createDraftTools(draftId: string) {
  const list_dataset_columns = tool(
    async () =>
      json({
        note: "All data is cached in Postgres from FantasyPros sync (rankings + season projections).",
        columns: DATASET_COLUMNS,
        sortable: PLAYER_SORT_COLUMNS,
        tip: "Use query_players with orderBy/orderDir to sort any numeric/name column.",
      }),
    {
      name: "list_dataset_columns",
      description:
        "Describe every analysis column available on the draft player dataset (ranks, projections, volume stats) and which ones are sortable.",
      schema: z.object({}),
    },
  );

  const get_draft_snapshot = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      return json(getDraftSnapshot(bundle));
    },
    {
      name: "get_draft_snapshot",
      description:
        "Return the current draft state: pick number, round, on-clock team, scoring, roster needs, projection coverage, sortable columns.",
      schema: z.object({}),
    },
  );

  const query_players = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const result = queryPlayers(rows, {
        nameContains: input.nameContains,
        position: input.position as Position | undefined,
        availableOnly: input.availableOnly,
        adpMin: input.adpMin,
        adpMax: input.adpMax,
        ecrMin: input.ecrMin,
        ecrMax: input.ecrMax,
        tier: input.tier,
        nflTeam: input.nflTeam,
        byeWeek: input.byeWeek,
        projPointsMin: input.projPointsMin,
        projPointsMax: input.projPointsMax,
        adpValueMin: input.adpValueMin,
        limit: input.limit,
        orderBy: input.orderBy,
        orderDir: input.orderDir,
        includeProjStats: input.includeProjStats,
      });
      return json({ count: result.length, orderBy: input.orderBy, orderDir: input.orderDir, players: result });
    },
    {
      name: "query_players",
      description:
        "SQL-shaped filter+sort over cached draft rankings/projections. Sort by ADP, ECR, projPoints, adpValue, rushYds, receptions, etc.",
      schema: z.object({
        nameContains: z.string().optional().describe("Case-insensitive substring match on player name"),
        position: positionSchema.optional(),
        availableOnly: z.boolean().optional().describe("If true, only undrafted players"),
        adpMin: z.number().optional(),
        adpMax: z.number().optional(),
        ecrMin: z.number().optional(),
        ecrMax: z.number().optional(),
        tier: z.number().optional(),
        nflTeam: z.string().optional().describe("NFL team abbreviation substring, e.g. KC"),
        byeWeek: z.number().int().optional(),
        projPointsMin: z.number().optional(),
        projPointsMax: z.number().optional(),
        adpValueMin: z.number().optional().describe("Minimum ADP−ECR value (positive = falling)"),
        limit: z.number().int().min(1).max(100).optional().default(25),
        orderBy: orderBySchema.optional().default("adp"),
        orderDir: z.enum(["asc", "desc"]).optional().describe("Defaults by column (ranks asc, points desc)"),
        includeProjStats: z
          .boolean()
          .optional()
          .describe("If true, include full projStats JSON (larger). Prefer false."),
      }),
    },
  );

  const aggregate_players = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const buckets = aggregatePlayers(rows, {
        groupBy: input.groupBy,
        availableOnly: input.availableOnly,
        metric: input.metric,
      });
      return json({ groupBy: input.groupBy, metric: input.metric ?? "adp", buckets });
    },
    {
      name: "aggregate_players",
      description:
        "Group players by position, tier, NFL team, or bye week with counts and min/avg/max for a metric (adp, ecr, projPoints, adpValue).",
      schema: z.object({
        groupBy: z.enum(["position", "tier", "nflTeam", "byeWeek"]),
        availableOnly: z.boolean().optional(),
        metric: z.enum(["adp", "ecr", "projPoints", "adpValue"]).optional().default("adp"),
      }),
    },
  );

  const get_player = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const matches = findPlayersByNameOrId(rows, input.query, input.limit ?? 10).map((r) =>
        input.includeProjStats ? r : { ...r, projStats: null },
      );
      return json({ matches });
    },
    {
      name: "get_player",
      description:
        "Look up players by name substring or FantasyPros id. Returns ranks, projections, and volume stats.",
      schema: z.object({
        query: z.string().describe("Player name or fp_player_id"),
        limit: z.number().int().min(1).max(25).optional().default(10),
        includeProjStats: z.boolean().optional().default(false),
      }),
    },
  );

  const compare_players = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const players = input.names.map((name) => {
        const matches = findPlayersByNameOrId(rows, name, 3).map((r) => ({ ...r, projStats: null }));
        return { query: name, matches };
      });
      return json({ players });
    },
    {
      name: "compare_players",
      description:
        "Side-by-side ADP/ECR/tier/projPoints/volume/availability for 2–5 player name queries.",
      schema: z.object({
        names: z.array(z.string()).min(2).max(5),
      }),
    },
  );

  const find_value_plays = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const players = findValuePlays(rows, {
        position: input.position as Position | undefined,
        minAdpValue: input.minAdpValue,
        limit: input.limit,
      });
      return json({
        definition: "adpValue = ADP − ECR; positive means experts like them more than ADP (falling).",
        players,
      });
    },
    {
      name: "find_value_plays",
      description:
        "Find available players with the largest ADP−ECR gaps (falling past ADP / expert value).",
      schema: z.object({
        position: positionSchema.optional(),
        minAdpValue: z.number().optional().default(3),
        limit: z.number().int().min(1).max(50).optional().default(15),
      }),
    },
  );

  const analyze_roster = tool(
    async (input) => {
      const { bundle } = await loadContext(draftId);
      let teamId = input.teamId;
      if (!teamId && input.teamName) {
        const needle = input.teamName.trim().toLowerCase();
        teamId = bundle.teams.find((t) => t.name.toLowerCase().includes(needle))?.id;
      }
      if (!teamId) {
        const user = bundle.teams.find((t) => t.id === bundle.draft.my_team_id) ?? bundle.teams.find((t) => t.is_user_team);
        teamId = user?.id;
      }
      if (!teamId) return json({ error: "No team specified and no user team marked." });
      return json(analyzeTeamRoster(bundle, teamId));
    },
    {
      name: "analyze_roster",
      description:
        "Analyze a team's drafted roster: position counts, projected points sum, bye-week clusters. Defaults to your team.",
      schema: z.object({
        teamId: z.string().uuid().optional(),
        teamName: z.string().optional(),
      }),
    },
  );

  const get_recommendations = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      const state = computeDraftState(bundle);
      if (!state.userTeam) {
        return json({ error: "No team is marked as yours for this draft." });
      }
      const availablePlayers = toAvailablePlayerVMs(state.availableRankings);
      const recommendations = computeRecommendations({
        candidates: availablePlayers.map((p) => ({
          fpPlayerId: p.fpPlayerId,
          name: p.name,
          position: p.position,
          rankAdp: p.rankAdp,
          rankEcr: p.rankEcr,
        })),
        currentPickNumber: state.currentPickNumber,
        numTeams: bundle.draft.num_teams,
        userDraftPosition: state.userTeam.draft_position,
        rosterSlots: bundle.rosterSlots,
        userAssignedSlots: bundle.picks
          .filter((p) => p.team_id === state.userTeam!.id)
          .map((p) => p.assigned_slot_type),
        limit: 10,
      });
      return json({ recommendations });
    },
    {
      name: "get_recommendations",
      description:
        "Return the app's scored pick recommendations for the user's team at the current pick (value + need + scarcity).",
      schema: z.object({}),
    },
  );

  const get_position_scarcity = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      const state = computeDraftState(bundle);
      const scarcity = computePositionScarcity(
        bundle.rankings.map((r) => ({
          position: r.players.position,
          rankAdp: r.rank_adp,
        })),
        bundle.picks.map((p) => p.players.position),
        state.currentPickNumber,
      );
      return json({ scarcity });
    },
    {
      name: "get_position_scarcity",
      description:
        "Compare drafted counts vs ADP-expected counts per position (run / normal / falling).",
      schema: z.object({}),
    },
  );

  const list_teams = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      return json({
        teams: bundle.teams.map((t) => ({
          id: t.id,
          name: t.name,
          draftPosition: t.draft_position,
          isUserTeam: t.is_user_team || t.id === bundle.draft.my_team_id,
        })),
      });
    },
    {
      name: "list_teams",
      description: "List draft teams with positions and which one is the user's.",
      schema: z.object({}),
    },
  );

  const web_search = tool(
    async (input) => {
      const result = await search(input.query, {
        safeSearch: SafeSearchType.MODERATE,
      });
      const results = (result.results ?? []).slice(0, input.maxResults ?? 5).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      }));
      return json({ query: input.query, results });
    },
    {
      name: "web_search",
      description:
        "Search the web (DuckDuckGo) for news, injuries, or context. Prefer draft DB tools for ADP/ECR/projections.",
      schema: z.object({
        query: z.string(),
        maxResults: z.number().int().min(1).max(8).optional().default(5),
      }),
    },
  );

  return [
    list_dataset_columns,
    get_draft_snapshot,
    query_players,
    aggregate_players,
    get_player,
    compare_players,
    find_value_plays,
    analyze_roster,
    list_teams,
    get_recommendations,
    get_position_scarcity,
    web_search,
  ];
}
