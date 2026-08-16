import type { LeagueRosterEntry, Position, SlotType } from "@/lib/supabase/types";

const FLEX_ELIGIBLE = new Set(["RB", "WR", "TE"]);
const STARTER_SLOTS = new Set(["QB", "RB", "WR", "TE", "FLEX", "DST", "K", "SUPERFLEX", "OP"]);

export interface StartSitPlayer {
  espnPlayerId: number;
  fpPlayerId: string | null;
  name: string;
  position: string;
  nflTeam: string | null;
  currentSlot: string;
  injuryStatus: string | null;
  weekProj: number | null;
}

export interface StartSitSuggestion {
  starters: StartSitPlayer[];
  bench: StartSitPlayer[];
  projectedStarterPoints: number;
  notes: string[];
}

function slotCapacity(
  slots: { slot_type: SlotType; count: number }[],
  slot: SlotType,
): number {
  return slots.filter((s) => s.slot_type === slot).reduce((sum, s) => sum + s.count, 0);
}

/**
 * Greedy lineup: fill QB/RB/WR/TE/DST/K by highest week proj, then FLEX from remaining RB/WR/TE.
 */
export function suggestStartSit(params: {
  roster: LeagueRosterEntry[];
  rosterSlots: { slot_type: SlotType; count: number }[];
  weekProjByFpId: Map<string, number | null>;
}): StartSitSuggestion {
  const notes: string[] = [];
  const players: StartSitPlayer[] = params.roster
    .filter((r) => r.lineup_slot !== "IR")
    .map((r) => ({
      espnPlayerId: r.espn_player_id,
      fpPlayerId: r.fp_player_id,
      name: r.player_name,
      position: r.position,
      nflTeam: r.nfl_team,
      currentSlot: r.lineup_slot,
      injuryStatus: r.injury_status,
      weekProj:
        r.fp_player_id != null
          ? (params.weekProjByFpId.get(r.fp_player_id) ?? null)
          : null,
    }));

  const available = [...players].sort(
    (a, b) => (b.weekProj ?? -1) - (a.weekProj ?? -1),
  );
  const used = new Set<number>();
  const starters: StartSitPlayer[] = [];

  const fill = (slot: SlotType, eligible: (p: StartSitPlayer) => boolean) => {
    const need = slotCapacity(params.rosterSlots, slot);
    let filled = 0;
    for (const p of available) {
      if (filled >= need) break;
      if (used.has(p.espnPlayerId)) continue;
      if (!eligible(p)) continue;
      starters.push({ ...p, currentSlot: slot });
      used.add(p.espnPlayerId);
      filled += 1;
    }
    if (filled < need) {
      notes.push(`Could only fill ${filled}/${need} ${slot} slots from available players.`);
    }
  };

  fill("QB", (p) => p.position === "QB");
  fill("RB", (p) => p.position === "RB");
  fill("WR", (p) => p.position === "WR");
  fill("TE", (p) => p.position === "TE");
  fill("FLEX", (p) => FLEX_ELIGIBLE.has(p.position));
  fill("DST", (p) => p.position === "DST");
  fill("K", (p) => p.position === "K");

  const bench = available.filter((p) => !used.has(p.espnPlayerId));
  const projectedStarterPoints = starters.reduce((sum, p) => sum + (p.weekProj ?? 0), 0);

  const injuredStarters = starters.filter(
    (p) => p.injuryStatus && !["ACTIVE", "NORMAL"].includes(p.injuryStatus.toUpperCase()),
  );
  if (injuredStarters.length > 0) {
    notes.push(
      `Injury flags on projected starters: ${injuredStarters.map((p) => `${p.name} (${p.injuryStatus})`).join(", ")}.`,
    );
  }

  const missingProj = starters.filter((p) => p.weekProj == null);
  if (missingProj.length > 0) {
    notes.push(
      `${missingProj.length} starter(s) lack weekly FantasyPros projections — sync projections or check ID mapping.`,
    );
  }

  // Flag obvious sits currently starting
  for (const p of players) {
    if (!STARTER_SLOTS.has(p.currentSlot) || p.currentSlot === "BENCH") continue;
    const suggested = starters.find((s) => s.espnPlayerId === p.espnPlayerId);
    if (!suggested) {
      const better = starters.find(
        (s) =>
          s.position === p.position &&
          (s.weekProj ?? 0) > (p.weekProj ?? 0) + 1 &&
          players.some((x) => x.espnPlayerId === s.espnPlayerId && x.currentSlot === "BENCH"),
      );
      if (better) {
        notes.push(`Consider sitting ${p.name} for ${better.name} (${better.weekProj ?? "?"} vs ${p.weekProj ?? "?"} pts).`);
      }
    }
  }

  return { starters, bench, projectedStarterPoints, notes };
}

export function positionNeedScores(
  roster: LeagueRosterEntry[],
  rosterSlots: { slot_type: SlotType; count: number }[],
): Record<string, number> {
  const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, K: 0 };
  for (const r of roster) {
    if (r.lineup_slot === "IR") continue;
    const pos = r.position as Position;
    if (pos in counts) counts[pos] += 1;
  }
  const need: Record<string, number> = {};
  for (const pos of Object.keys(counts)) {
    const starterNeed =
      slotCapacity(rosterSlots, pos as SlotType) +
      (FLEX_ELIGIBLE.has(pos) ? Math.ceil(slotCapacity(rosterSlots, "FLEX") / 3) : 0);
    // Higher when thin at the position
    need[pos] = Math.max(0, starterNeed + 1 - counts[pos]);
  }
  return need;
}
