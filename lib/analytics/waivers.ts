import type { LeagueRosterEntry, SlotType } from "@/lib/supabase/types";
import { positionNeedScores } from "@/lib/analytics/start-sit";

export interface FreeAgentCandidate {
  fpPlayerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  weekProj: number | null;
  rosProj: number | null;
  /** NFL week for weekProj (FantasyPros); null if only ROS loaded. */
  projectionWeek?: number | null;
  /** ESPN current-week projection when FP week is missing/stale. */
  espnWeekProj?: number | null;
  /** Mean fantasy points over the last completed weeks (ESPN actuals). */
  recentAvg?: number | null;
  /** Games in the recentAvg window. */
  recentGames?: number | null;
  seasonAvg?: number | null;
  dataFlags?: string[];
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
    const weekPts = fa.weekProj ?? fa.espnWeekProj ?? 0;
    const ros = fa.rosProj ?? 0;
    const recent = fa.recentAvg ?? 0;
    // Prefer weekly upside when need is high; still reward ROS.
    // When week proj is missing, lean on recent ESPN form so hot FAs are not buried by stale ROS.
    const weekWeight = fa.weekProj != null || fa.espnWeekProj != null ? 1.2 : 0;
    const recentWeight = fa.weekProj == null ? 1.0 : 0.35;
    const rosWeight = fa.weekProj == null && (fa.recentAvg ?? 0) >= 10 ? 0.02 : 0.05;
    const score =
      weekPts * weekWeight + recent * recentWeight + ros * rosWeight + needScore * 8;
    const weekLabel =
      fa.weekProj != null
        ? fa.projectionWeek != null
          ? `FP W${fa.projectionWeek} ${fa.weekProj.toFixed(1)}`
          : `FP week ${fa.weekProj.toFixed(1)}`
        : fa.espnWeekProj != null
          ? `ESPN week ${fa.espnWeekProj.toFixed(1)}`
          : "No week proj";
    const rationaleParts = [
      weekLabel,
      fa.rosProj != null ? `FP ROS ${fa.rosProj.toFixed(1)}` : "No FP ROS",
    ];
    if (fa.recentAvg != null && (fa.recentGames ?? 0) > 0) {
      rationaleParts.push(
        `recent ${fa.recentGames}-wk avg ${fa.recentAvg.toFixed(1)}`,
      );
    }
    if (fa.dataFlags && fa.dataFlags.length > 0) {
      rationaleParts.push(`flags: ${fa.dataFlags.join(", ")}`);
    }
    if (needScore > 0) rationaleParts.push(`fills ${fa.position} need`);
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
