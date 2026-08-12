import { z } from "zod";

const FP_BASE_URL = "https://api.fantasypros.com/public/v2/json/nfl";

const fpPlayerSchema = z.object({
  player_id: z.union([z.number(), z.string()]).transform(String),
  player_name: z.string(),
  player_team_id: z.string().nullable().optional(),
  player_position_id: z.string(),
  player_bye_week: z.union([z.number(), z.string()]).nullable().optional(),
  rank_ecr: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  rank_min: z.union([z.number(), z.string()]).nullable().optional(),
  rank_max: z.union([z.number(), z.string()]).nullable().optional(),
  rank_std: z.union([z.number(), z.string()]).nullable().optional(),
  tier: z.union([z.number(), z.string()]).nullable().optional(),
});

const fpResponseSchema = z.object({
  players: z.array(fpPlayerSchema),
});

export type FpPlayer = z.infer<typeof fpPlayerSchema>;

export type FpScoring = "STD" | "PPR" | "HALF";
export type FpRankingType = "ADP" | "ROS" | "DK" | "WW";

interface FetchConsensusRankingsParams {
  season: number;
  scoring: FpScoring;
  type: FpRankingType;
  position?: string;
}

export class FantasyProsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FantasyProsApiError";
  }
}

/**
 * Calls FantasyPros' consensus-rankings endpoint. Requires FANTASYPROS_API_KEY
 * to be set server-side; never call this from client code.
 */
export async function fetchConsensusRankings({
  season,
  scoring,
  type,
  position = "ALL",
}: FetchConsensusRankingsParams): Promise<FpPlayer[]> {
  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) {
    throw new FantasyProsApiError("FANTASYPROS_API_KEY is not configured");
  }

  const url = new URL(`${FP_BASE_URL}/${season}/consensus-rankings`);
  url.searchParams.set("position", position);
  url.searchParams.set("scoring", scoring);
  url.searchParams.set("type", type);
  url.searchParams.set("week", "0");

  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new FantasyProsApiError(
      `FantasyPros request failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  const json = await response.json();
  const parsed = fpResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new FantasyProsApiError(
      `Unexpected FantasyPros response shape: ${parsed.error.message}`,
    );
  }

  return parsed.data.players;
}

const POSITION_ALIASES: Record<string, string> = { DEF: "DST", PK: "K" };

export function normalizePosition(rawPosition: string): string {
  const upper = rawPosition.toUpperCase();
  return POSITION_ALIASES[upper] ?? upper;
}
