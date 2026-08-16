import type { LeagueRosterEntry, SlotType } from "@/lib/supabase/types";
import { positionNeedScores } from "@/lib/analytics/start-sit";

export interface FreeAgentCandidate {
  fpPlayerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  weekProj: number | null;
  rosProj: number | null;
}

export interface WaiverTarget extends FreeAgentCandidate {
  score: number;
  needScore: number;
  rationale: string;
}

export function rankWaiverTargets(params: {
  freeAgents: FreeAgentCandidate[];
  yourRoster: LeagueRosterEntry[];
  rosterSlots: { slot_type: SlotType; count: number }[];
  limit?: number;
}): WaiverTarget[] {
  const need = positionNeedScores(params.yourRoster, params.rosterSlots);
  const limit = params.limit ?? 25;

  const scored = params.freeAgents.map((fa) => {
    const needScore = need[fa.position] ?? 0;
    const week = fa.weekProj ?? 0;
    const ros = fa.rosProj ?? 0;
    // Prefer weekly upside when need is high; still reward ROS.
    const score = week * 1.2 + ros * 0.05 + needScore * 8;
    const rationaleParts = [
      fa.weekProj != null ? `Week ${fa.weekProj.toFixed(1)}` : "No week proj",
      fa.rosProj != null ? `ROS ${fa.rosProj.toFixed(1)}` : "No ROS",
    ];
    if (needScore > 0) rationaleParts.push(`fills ${fa.position} need (${needScore})`);
    return {
      ...fa,
      score,
      needScore,
      rationale: rationaleParts.join(" · "),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
