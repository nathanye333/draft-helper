import type { InjuryBoardPlayer, InjuryDeltaView, RosterPlayerForNews } from "@/lib/news/types";

const HEALTHY = new Set(["ACTIVE", "NORMAL", "HEALTHY", ""]);

const SEVERITY_ORDER: Record<string, number> = {
  OUT: 0,
  IR: 1,
  DOUBTFUL: 2,
  QUESTIONABLE: 3,
  PROBABLE: 4,
  PUP: 5,
  SUSP: 6,
};

function injuryRank(status: string): number {
  const key = status.toUpperCase();
  return SEVERITY_ORDER[key] ?? 50;
}

export function isHealthyStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  return HEALTHY.has(status.toUpperCase());
}

export function buildInjuryBoard(
  players: RosterPlayerForNews[],
  deltas: InjuryDeltaView[],
): InjuryBoardPlayer[] {
  const deltaByPlayer = new Map(deltas.map((d) => [d.espnPlayerId, d]));

  return players
    .filter((p) => !isHealthyStatus(p.injuryStatus))
    .map((p) => ({
      espnPlayerId: p.espnPlayerId,
      name: p.name,
      position: p.position,
      nflTeam: p.nflTeam,
      lineupSlot: p.lineupSlot,
      injuryStatus: p.injuryStatus ?? "UNKNOWN",
      headshotUrl: p.headshotUrl,
      isStarter: p.isStarter,
      scope: p.scope,
      delta: deltaByPlayer.get(p.espnPlayerId) ?? null,
    }))
    .sort((a, b) => {
      const starterDiff = Number(b.isStarter) - Number(a.isStarter);
      if (starterDiff !== 0) return starterDiff;
      const rankDiff = injuryRank(a.injuryStatus) - injuryRank(b.injuryStatus);
      if (rankDiff !== 0) return rankDiff;
      return a.name.localeCompare(b.name);
    });
}
