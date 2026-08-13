export type ScoringFormat = "STD" | "PPR" | "HALF";
export type DraftType = "snake" | "auction";
export type DraftStatus = "setup" | "live" | "complete";
export type SlotType = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DST" | "BENCH";
export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

export interface Draft {
  id: string;
  user_id: string;
  name: string;
  season: number;
  num_teams: number;
  draft_type: DraftType;
  scoring: ScoringFormat;
  status: DraftStatus;
  my_team_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftTeam {
  id: string;
  draft_id: string;
  name: string;
  draft_position: number;
  is_user_team: boolean;
  created_at: string;
}

export interface RosterSlot {
  id: string;
  draft_id: string;
  slot_type: SlotType;
  count: number;
  sort_order: number;
  created_at: string;
}

export interface Player {
  fp_player_id: string;
  name: string;
  position: Position;
  nfl_team: string | null;
  bye_week: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlayerRanking {
  id: string;
  draft_id: string;
  fp_player_id: string;
  rank_ecr: number | null;
  rank_adp: number | null;
  rank_min: number | null;
  rank_max: number | null;
  rank_std: number | null;
  tier: number | null;
  /** Scoring-aware projected fantasy points (season / week 0). */
  proj_points: number | null;
  /** Raw FantasyPros projection stats blob (pass/rush/rec/etc.). */
  proj_stats: Record<string, number> | null;
  synced_at: string;
}

export interface DraftPick {
  id: string;
  draft_id: string;
  pick_number: number;
  round: number;
  team_id: string;
  fp_player_id: string;
  assigned_slot_type: SlotType;
  adp_delta: number | null;
  created_at: string;
}

/** Denormalized view used throughout the UI: a ranking joined with its player row. */
export interface RankedPlayer extends Player {
  ranking: PlayerRanking | null;
}

export const DEFAULT_ROSTER_SLOTS: { slot_type: SlotType; count: number; sort_order: number }[] = [
  { slot_type: "QB", count: 1, sort_order: 0 },
  { slot_type: "RB", count: 2, sort_order: 1 },
  { slot_type: "WR", count: 2, sort_order: 2 },
  { slot_type: "TE", count: 1, sort_order: 3 },
  { slot_type: "FLEX", count: 1, sort_order: 4 },
  { slot_type: "K", count: 1, sort_order: 5 },
  { slot_type: "DST", count: 1, sort_order: 6 },
  { slot_type: "BENCH", count: 6, sort_order: 7 },
];
