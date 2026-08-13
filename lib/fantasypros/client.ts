import { z } from "zod";

/** Unofficial partner feed — returns full consensus boards (not the 10-player public API cap). */
const FP_PARTNERS_BASE = "https://partners.fantasypros.com/api/v1";

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
export type FpRankingType = "ADP" | "ROS" | "DRAFT";

const PROJECTION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;

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

async function partnersFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${FP_PARTNERS_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new FantasyProsApiError(
      `FantasyPros request failed: ${response.status} ${response.statusText}`,
      response.status,
    );
  }

  return response.json();
}

/**
 * Consensus rankings / ADP from FantasyPros partner feed (full board).
 * Server-only — do not call from the browser.
 */
export async function fetchConsensusRankings({
  season,
  scoring,
  type,
  position = "ALL",
}: FetchConsensusRankingsParams): Promise<FpPlayer[]> {
  const json = await partnersFetch("/consensus-rankings.php", {
    sport: "NFL",
    year: String(season),
    position,
    scoring,
    type,
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
 * Season projections (week=0), fetched per position and merged.
 */
export async function fetchProjections({
  season,
  scoring,
  week = 0,
}: FetchProjectionsParams): Promise<FpProjectionPlayer[]> {
  const chunks = await Promise.all(
    PROJECTION_POSITIONS.map(async (position) => {
      const json = await partnersFetch("/nfl-projections.php", {
        year: String(season),
        week: String(week),
        position,
        scoring,
      });
      const parsed = fpProjectionsResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new FantasyProsApiError(
          `Unexpected FantasyPros projections response shape (${position}): ${parsed.error.message}`,
        );
      }
      return parsed.data.players;
    }),
  );

  const byId = new Map<string, FpProjectionPlayer>();
  for (const p of chunks.flat()) {
    const playerId = p.fpid ?? p.player_id;
    if (!playerId || byId.has(playerId)) continue;
    byId.set(playerId, {
      playerId,
      name: p.name ?? p.player_name ?? playerId,
      position: p.position_id ?? p.player_position_id ?? "UNK",
      nflTeam: p.team_id ?? p.player_team_id ?? null,
      stats: p.stats ?? {},
    });
  }

  return Array.from(byId.values());
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
