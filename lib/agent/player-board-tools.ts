import { tool } from "langchain";
import { z } from "zod";
import {
  aggregatePlayers,
  DATASET_COLUMNS,
  findPlayersByNameOrId,
  findValuePlays,
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

/**
 * Shared FantasyPros board tools (query/compare/value) used by draft and season agents.
 */
export function createPlayerBoardTools(options: {
  loadRows: () => Promise<PlayerRow[]>;
  /** Clarifies what `available` means in this context. */
  availabilityNote: string;
}) {
  const { loadRows, availabilityNote } = options;

  const list_dataset_columns = tool(
    async () =>
      json({
        note: `All data is cached in Postgres from FantasyPros sync (shared rankings + season projections). ${availabilityNote}`,
        columns: DATASET_COLUMNS,
        sortable: PLAYER_SORT_COLUMNS,
        tip: "Use query_players with orderBy/orderDir to sort any numeric/name column.",
      }),
    {
      name: "list_dataset_columns",
      description:
        "Describe every analysis column available on the FantasyPros player dataset (ranks, projections, volume stats) and which ones are sortable.",
      schema: z.object({}),
    },
  );

  const query_players = tool(
    async (input) => {
      const rows = await loadRows();
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
        draftYear: input.draftYear,
        draftYearMin: input.draftYearMin,
        draftYearMax: input.draftYearMax,
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
        "SQL-shaped filter+sort over cached FantasyPros rankings/projections. Sort by ADP, ECR, projPoints, adpValue, draftYear, rushYds, receptions, etc.",
      schema: z.object({
        nameContains: z.string().optional().describe("Case-insensitive substring match on player name"),
        position: positionSchema.optional(),
        availableOnly: z
          .boolean()
          .optional()
          .describe(`If true, only available players (${availabilityNote})`),
        adpMin: z.number().optional(),
        adpMax: z.number().optional(),
        ecrMin: z.number().optional(),
        ecrMax: z.number().optional(),
        tier: z.number().optional(),
        nflTeam: z.string().optional().describe("NFL team abbreviation substring, e.g. KC"),
        byeWeek: z.number().int().optional(),
        draftYear: z.number().int().optional().describe("Exact NFL draft / rookie year"),
        draftYearMin: z.number().int().optional().describe("Minimum draft year inclusive"),
        draftYearMax: z.number().int().optional().describe("Maximum draft year inclusive"),
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
      const rows = await loadRows();
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
        "Group players by position, tier, NFL team, bye week, or NFL draft year with counts and min/avg/max for a metric (adp, ecr, projPoints, adpValue).",
      schema: z.object({
        groupBy: z.enum(["position", "tier", "nflTeam", "byeWeek", "draftYear"]),
        availableOnly: z.boolean().optional(),
        metric: z.enum(["adp", "ecr", "projPoints", "adpValue"]).optional().default("adp"),
      }),
    },
  );

  const get_player = tool(
    async (input) => {
      const rows = await loadRows();
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
      const rows = await loadRows();
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
      const rows = await loadRows();
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

  return [
    list_dataset_columns,
    query_players,
    aggregate_players,
    get_player,
    compare_players,
    find_value_plays,
  ];
}
