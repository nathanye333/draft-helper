import type { SlotType } from "@/lib/supabase/types";
import { isStarterSlot } from "@/lib/league/slot-order";

export type WorkingLineupEntry = {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  slot: string;
  weekProj: number | null;
  injuryStatus: string | null;
};

export type LineupSeat = {
  /** Stable seat id, e.g. RB-0, BENCH-2, IR-1 */
  seatId: string;
  slotType: string;
  playerId: number | null;
};

const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);
const SUPERFLEX_ELIGIBLE = new Set(["QB", "RB", "WR", "TE"]);

export function slotCapacity(
  slots: { slot_type: SlotType; count: number }[],
  slot: SlotType,
): number {
  return slots.filter((s) => s.slot_type === slot).reduce((sum, s) => sum + s.count, 0);
}

/** Build ordered empty seats from league roster slot settings. */
export function buildSeatsFromSlots(
  rosterSlots: { slot_type: SlotType; count: number }[],
): LineupSeat[] {
  const order: SlotType[] = [
    "QB",
    "RB",
    "WR",
    "TE",
    "FLEX",
    "DST",
    "K",
    "BENCH",
    "IR",
  ];
  const seats: LineupSeat[] = [];
  for (const slotType of order) {
    const count = slotCapacity(rosterSlots, slotType);
    for (let i = 0; i < count; i++) {
      seats.push({ seatId: `${slotType}-${i}`, slotType, playerId: null });
    }
  }
  // Include any other slot types from settings (SUPERFLEX, etc.).
  for (const s of rosterSlots) {
    if (order.includes(s.slot_type)) continue;
    for (let i = 0; i < s.count; i++) {
      seats.push({ seatId: `${s.slot_type}-${i}`, slotType: s.slot_type, playerId: null });
    }
  }
  return seats;
}

export function playerEligibleForSlot(position: string, slotType: string): boolean {
  if (slotType === "BENCH" || slotType === "IR") return true;
  if (slotType === "FLEX") return FLEX_ELIGIBLE.has(position);
  if (slotType === "SUPERFLEX" || slotType === "OP") return SUPERFLEX_ELIGIBLE.has(position);
  if (slotType === "DST") return position === "DST";
  return position === slotType;
}

export function assignPlayersToSeats(
  seats: LineupSeat[],
  assignments: { espnPlayerId: number; slot: string }[],
): LineupSeat[] {
  const next = seats.map((s) => ({ ...s, playerId: null as number | null }));
  const usedPlayers = new Set<number>();
  const usedSeats = new Set<string>();

  for (const a of assignments) {
    const seat = next.find(
      (s) => s.slotType === a.slot && !usedSeats.has(s.seatId) && s.playerId == null,
    );
    if (!seat) continue;
    seat.playerId = a.espnPlayerId;
    usedSeats.add(seat.seatId);
    usedPlayers.add(a.espnPlayerId);
  }

  // Overflow → first open BENCH, then IR.
  for (const a of assignments) {
    if (usedPlayers.has(a.espnPlayerId)) continue;
    const seat =
      next.find((s) => s.slotType === "BENCH" && s.playerId == null) ??
      next.find((s) => s.slotType === "IR" && s.playerId == null);
    if (!seat) continue;
    seat.playerId = a.espnPlayerId;
    usedPlayers.add(a.espnPlayerId);
  }

  return next;
}

export function starterProjectedPoints(
  seats: LineupSeat[],
  weekProjByPlayerId: Map<number, number | null>,
): number {
  let sum = 0;
  for (const seat of seats) {
    if (seat.playerId == null) continue;
    if (!isStarterSlot(seat.slotType)) continue;
    sum += weekProjByPlayerId.get(seat.playerId) ?? 0;
  }
  return sum;
}

export function seatsToWorkingLineup(
  seats: LineupSeat[],
  playersById: Map<
    number,
    {
      name: string;
      position: string;
      nflTeam: string | null;
      weekProj: number | null;
      injuryStatus: string | null;
    }
  >,
): WorkingLineupEntry[] {
  const out: WorkingLineupEntry[] = [];
  for (const seat of seats) {
    if (seat.playerId == null) continue;
    const p = playersById.get(seat.playerId);
    if (!p) continue;
    out.push({
      espnPlayerId: seat.playerId,
      name: p.name,
      position: p.position,
      nflTeam: p.nflTeam,
      slot: seat.slotType,
      weekProj: p.weekProj,
      injuryStatus: p.injuryStatus,
    });
  }
  return out;
}

const STORAGE_PREFIX = "draft-helper:working-lineup:";
const EVENT_NAME = "draft-helper-working-lineup";

export function workingLineupStorageKey(leagueId: string): string {
  return `${STORAGE_PREFIX}${leagueId}`;
}

export function publishWorkingLineup(leagueId: string, lineup: WorkingLineupEntry[] | null) {
  if (typeof window === "undefined") return;
  const key = workingLineupStorageKey(leagueId);
  if (lineup == null || lineup.length === 0) {
    sessionStorage.removeItem(key);
  } else {
    sessionStorage.setItem(key, JSON.stringify(lineup));
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { leagueId } }));
}

export function readWorkingLineup(leagueId: string): WorkingLineupEntry[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(workingLineupStorageKey(leagueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkingLineupEntry[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function subscribeWorkingLineup(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener("storage", handler);
  };
}

/** Swap or move a player onto a target seat. Returns null if illegal. */
export function movePlayerToSeat(
  seats: LineupSeat[],
  fromSeatId: string,
  toSeatId: string,
  positionByPlayerId: Map<number, string>,
): LineupSeat[] | null {
  if (fromSeatId === toSeatId) return seats;
  const from = seats.find((s) => s.seatId === fromSeatId);
  const to = seats.find((s) => s.seatId === toSeatId);
  if (!from || !to || from.playerId == null) return null;

  const movingPos = positionByPlayerId.get(from.playerId);
  if (!movingPos || !playerEligibleForSlot(movingPos, to.slotType)) return null;

  if (to.playerId != null) {
    const stayingPos = positionByPlayerId.get(to.playerId);
    if (!stayingPos || !playerEligibleForSlot(stayingPos, from.slotType)) return null;
  }

  return seats.map((s) => {
    if (s.seatId === from.seatId) return { ...s, playerId: to.playerId };
    if (s.seatId === to.seatId) return { ...s, playerId: from.playerId };
    return s;
  });
}
