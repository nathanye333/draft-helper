import { tool } from "langchain";
import { search, SafeSearchType } from "duck-duck-scrape";
import { z } from "zod";
import { computeRecommendations } from "@/lib/analytics/recommendations";
import { computePositionScarcity } from "@/lib/analytics/scarcity";
import { fetchDraftBundle, type DraftBundle } from "@/lib/draft/data";
import { computeDraftState, toAvailablePlayerVMs } from "@/lib/draft/view";
import {
  aggregatePlayers,
  buildPlayerRows,
  findPlayersByNameOrId,
  getDraftSnapshot,
  queryPlayers,
  type PlayerRow,
} from "@/lib/agent/player-query";
import type { Position } from "@/lib/supabase/types";

const positionSchema = z.enum(["QB", "RB", "WR", "TE", "K", "DST"]);

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

async function loadContext(draftId: string): Promise<{
  bundle: DraftBundle;
  rows: PlayerRow[];
}> {
  const bundle = await fetchDraftBundle(draftId);
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
  const get_draft_snapshot = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      return json(getDraftSnapshot(bundle));
    },
    {
      name: "get_draft_snapshot",
      description:
        "Return the current draft state: pick number, round, on-clock team, scoring, user roster needs, and counts.",
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
        limit: input.limit,
        orderBy: input.orderBy,
      });
      return json({ count: result.length, players: result });
    },
    {
      name: "query_players",
      description:
        "SQL-shaped filter over this draft's rankings. Filter by name, position, availability, ADP/ECR ranges, tier, NFL team; order and limit results.",
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
        limit: z.number().int().min(1).max(100).optional().default(25),
        orderBy: z.enum(["adp", "ecr", "name", "tier"]).optional().default("adp"),
      }),
    },
  );

  const aggregate_players = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const buckets = aggregatePlayers(rows, {
        groupBy: input.groupBy,
        availableOnly: input.availableOnly,
      });
      return json({ groupBy: input.groupBy, buckets });
    },
    {
      name: "aggregate_players",
      description:
        "Group players by position, tier, or NFL team with counts and ADP min/avg/max. Useful for board analysis.",
      schema: z.object({
        groupBy: z.enum(["position", "tier", "nflTeam"]),
        availableOnly: z.boolean().optional().describe("If true, aggregate only undrafted players"),
      }),
    },
  );

  const get_player = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const matches = findPlayersByNameOrId(rows, input.query, input.limit ?? 10);
      return json({ matches });
    },
    {
      name: "get_player",
      description: "Look up one or more players by name substring or exact FantasyPros player id.",
      schema: z.object({
        query: z.string().describe("Player name or fp_player_id"),
        limit: z.number().int().min(1).max(25).optional().default(10),
      }),
    },
  );

  const compare_players = tool(
    async (input) => {
      const { rows } = await loadContext(draftId);
      const players = input.names.map((name) => {
        const matches = findPlayersByNameOrId(rows, name, 3);
        return { query: name, matches };
      });
      return json({ players });
    },
    {
      name: "compare_players",
      description: "Side-by-side ADP/ECR/tier/availability for 2–5 player name queries.",
      schema: z.object({
        names: z.array(z.string()).min(2).max(5),
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
        "Search the web (DuckDuckGo) for news, injuries, or context. Prefer draft tools for ADP/ECR/availability.",
      schema: z.object({
        query: z.string(),
        maxResults: z.number().int().min(1).max(8).optional().default(5),
      }),
    },
  );

  return [
    get_draft_snapshot,
    query_players,
    aggregate_players,
    get_player,
    compare_players,
    get_recommendations,
    get_position_scarcity,
    web_search,
  ];
}
