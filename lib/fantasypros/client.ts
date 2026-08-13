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

const fpProjectionStatsSchema = z.record(
  z.string(),
  z.union([z.number(), z.string()]).transform(Number),
);

const fpProjectionPlayerSchema = z.object({
  fpid: z.union([z.number(), z.string()]).transform(String).optional(),
  player_id: z.union([z.number(), z.string()]).transform(String).optional(),
  name: z.string().optional(),
  player_name: z.string().optional(),
  position_id: z.string().optional(),
  player_position_id: z.string().optional(),
  team_id: z.string().nullable().optional(),
  player_team_id: z.string().nullable().optional(),
  stats: fpProjectionStatsSchema.optional(),
});

const fpProjectionsResponseSchema = z.object({
  players: z.array(fpProjectionPlayerSchema),
});

export type FpPlayer = z.infer<typeof fpPlayerSchema>;
export type FpProjectionPlayer = {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  stats: Record<string, number>;
};

export type FpScoring = "STD" | "PPR" | "HALF";
export type FpRankingType = "ADP" | "ROS" | "DK" | "WW";

interface FetchConsensusRankingsParams {
  season: number;
  scoring: FpScoring;
  type: FpRankingType;
  position?: string;
}

interface FetchProjectionsParams {
  season: number;
  scoring: FpScoring;
  /** Use 0 for preseason / season-long projections. */
  week?: number;
}

export class FantasyProsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FantasyProsApiError";
  }
}

async function fpFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.FANTASYPROS_API_KEY;
  if (!apiKey) {
    throw new FantasyProsApiError("FANTASYPROS_API_KEY is not configured");
  }

  const url = new URL(`${FP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

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

  return response.json();
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
  const json = await fpFetch(`/${season}/consensus-rankings`, {
    position,
    scoring,
    type,
    week: "0",
  });

  const parsed = fpResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new FantasyProsApiError(
      `Unexpected FantasyPros rankings response shape: ${parsed.error.message}`,
    );
  }

  return parsed.data.players;
}

/**
 * Season projections (week=0). Stats include points / points_ppr / points_half
 * plus position-specific volume (pass/rush/rec/etc.).
 */
export async function fetchProjections({
  season,
  scoring,
  week = 0,
}: FetchProjectionsParams): Promise<FpProjectionPlayer[]> {
  const json = await fpFetch(`/${season}/projections`, {
    week: String(week),
    scoring,
    positions: "QB:RB:WR:TE:K:DST",
  });

  const parsed = fpProjectionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new FantasyProsApiError(
      `Unexpected FantasyPros projections response shape: ${parsed.error.message}`,
    );
  }

  return parsed.data.players
    .map((p) => {
      const playerId = p.fpid ?? p.player_id;
      if (!playerId) return null;
      return {
        playerId,
        name: p.name ?? p.player_name ?? playerId,
        position: p.position_id ?? p.player_position_id ?? "UNK",
        nflTeam: p.team_id ?? p.player_team_id ?? null,
        stats: p.stats ?? {},
      };
    })
    .filter((p): p is FpProjectionPlayer => p != null);
}

/** Pick the FantasyPros points field matching the draft's scoring format. */
export function scoringAwareProjectedPoints(
  stats: Record<string, number>,
  scoring: FpScoring,
): number | null {
  const key = scoring === "PPR" ? "points_ppr" : scoring === "HALF" ? "points_half" : "points";
  const preferred = stats[key];
  if (preferred != null && Number.isFinite(preferred)) return preferred;
  const fallback = stats.points;
  return fallback != null && Number.isFinite(fallback) ? fallback : null;
}

const POSITION_ALIASES: Record<string, string> = { DEF: "DST", PK: "K" };

export function normalizePosition(rawPosition: string): string {
  const upper = rawPosition.toUpperCase();
  return POSITION_ALIASES[upper] ?? upper;
}
