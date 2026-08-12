import { getRoundForPick, getTeamPositionForPick } from "@/lib/draft/snake";
import type { DraftBundle, RankingWithPlayer } from "@/lib/draft/data";
import type { DraftTeam, Position, SlotType } from "@/lib/supabase/types";

export interface AvailablePlayerVM {
  fpPlayerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
  rankAdp: number | null;
  rankEcr: number | null;
  tier: number | null;
}

export interface PickFeedVM {
  id: string;
  pickNumber: number;
  round: number;
  teamName: string;
  isUserTeam: boolean;
  playerName: string;
  position: Position;
  assignedSlotType: string;
  adpDelta: number | null;
}

export function toPickFeedVMs(bundle: DraftBundle): PickFeedVM[] {
  return bundle.picks.map((p) => ({
    id: p.id,
    pickNumber: p.pick_number,
    round: p.round,
    teamName: p.draft_teams.name,
    isUserTeam: p.draft_teams.is_user_team,
    playerName: p.players.name,
    position: p.players.position,
    assignedSlotType: p.assigned_slot_type,
    adpDelta: p.adp_delta,
  }));
}

export function toAvailablePlayerVMs(rankings: RankingWithPlayer[]): AvailablePlayerVM[] {
  return rankings.map((r) => ({
    fpPlayerId: r.fp_player_id,
    name: r.players.name,
    position: r.players.position,
    nflTeam: r.players.nfl_team,
    rankAdp: r.rank_adp,
    rankEcr: r.rank_ecr,
    tier: r.tier,
  }));
}

export interface RosterSlotVM {
  slotType: SlotType;
  playerNames: (string | null)[];
}

export function computeRosterForTeam(bundle: DraftBundle, teamId: string): RosterSlotVM[] {
  const picksForTeam = bundle.picks.filter((p) => p.team_id === teamId);

  return bundle.rosterSlots.map((slot) => {
    const filled = picksForTeam
      .filter((p) => p.assigned_slot_type === slot.slot_type)
      .map((p) => p.players.name);
    const playerNames: (string | null)[] = Array.from(
      { length: slot.count },
      (_, i) => filled[i] ?? null,
    );
    return { slotType: slot.slot_type, playerNames };
  });
}

export interface DraftState {
  currentPickNumber: number;
  currentRound: number;
  onClockTeam: DraftTeam | null;
  draftedFpPlayerIds: Set<string>;
  availableRankings: RankingWithPlayer[];
  userTeam: DraftTeam | null;
}

export function computeDraftState(bundle: DraftBundle): DraftState {
  const currentPickNumber = bundle.picks.length + 1;
  const currentRound = getRoundForPick(currentPickNumber, bundle.draft.num_teams);
  const onClockPosition = getTeamPositionForPick(currentPickNumber, bundle.draft.num_teams);
  const onClockTeam = bundle.teams.find((t) => t.draft_position === onClockPosition) ?? null;

  const draftedFpPlayerIds = new Set(bundle.picks.map((p) => p.fp_player_id));
  const availableRankings = bundle.rankings.filter((r) => !draftedFpPlayerIds.has(r.fp_player_id));

  const userTeam = bundle.teams.find((t) => t.id === bundle.draft.my_team_id) ?? bundle.teams.find((t) => t.is_user_team) ?? null;

  return { currentPickNumber, currentRound, onClockTeam, draftedFpPlayerIds, availableRankings, userTeam };
}
