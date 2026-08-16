import type { LeagueRosterEntry } from "@/lib/supabase/types";
import { positionNeedScores } from "@/lib/analytics/start-sit";
import type { SlotType } from "@/lib/supabase/types";

export interface TradeSidePlayer {
  espnPlayerId: number;
  name: string;
  position: string;
  rosProj: number | null;
  weekProj: number | null;
}

export interface TradeEvaluation {
  give: TradeSidePlayer[];
  get: TradeSidePlayer[];
  giveRos: number;
  getRos: number;
  rosDelta: number;
  giveWeek: number;
  getWeek: number;
  yourNeedBefore: Record<string, number>;
  yourNeedAfter: Record<string, number>;
  theirNeedBefore: Record<string, number>;
  theirNeedAfter: Record<string, number>;
  verdict: "accept" | "lean_accept" | "fair" | "lean_reject" | "reject";
  rationale: string;
}

function sumProj(players: TradeSidePlayer[], key: "rosProj" | "weekProj"): number {
  return players.reduce((sum, p) => sum + (p[key] ?? 0), 0);
}

function applyTrade(
  roster: LeagueRosterEntry[],
  removeIds: Set<number>,
  add: TradeSidePlayer[],
  espnTeamId: number,
): LeagueRosterEntry[] {
  const kept = roster.filter((r) => !removeIds.has(r.espn_player_id));
  const added: LeagueRosterEntry[] = add.map((p) => ({
    id: `tmp-${p.espnPlayerId}`,
    league_id: roster[0]?.league_id ?? "",
    espn_team_id: espnTeamId,
    espn_player_id: p.espnPlayerId,
    player_name: p.name,
    position: p.position,
    nfl_team: null,
    lineup_slot: "BENCH",
    injury_status: null,
    fp_player_id: null,
    updated_at: new Date().toISOString(),
  }));
  return [...kept, ...added];
}

export function evaluateTrade(params: {
  yourRoster: LeagueRosterEntry[];
  theirRoster: LeagueRosterEntry[];
  give: TradeSidePlayer[];
  get: TradeSidePlayer[];
  yourEspnTeamId: number;
  theirEspnTeamId: number;
  rosterSlots: { slot_type: SlotType; count: number }[];
}): TradeEvaluation {
  const giveRos = sumProj(params.give, "rosProj");
  const getRos = sumProj(params.get, "rosProj");
  const giveWeek = sumProj(params.give, "weekProj");
  const getWeek = sumProj(params.get, "weekProj");
  const rosDelta = getRos - giveRos;

  const yourNeedBefore = positionNeedScores(params.yourRoster, params.rosterSlots);
  const theirNeedBefore = positionNeedScores(params.theirRoster, params.rosterSlots);

  const giveIds = new Set(params.give.map((p) => p.espnPlayerId));
  const getIds = new Set(params.get.map((p) => p.espnPlayerId));

  const yourAfter = applyTrade(params.yourRoster, giveIds, params.get, params.yourEspnTeamId);
  const theirAfter = applyTrade(params.theirRoster, getIds, params.give, params.theirEspnTeamId);

  const yourNeedAfter = positionNeedScores(yourAfter, params.rosterSlots);
  const theirNeedAfter = positionNeedScores(theirAfter, params.rosterSlots);

  const needImprovement = Object.keys(yourNeedBefore).reduce((sum, pos) => {
    return sum + (yourNeedBefore[pos] - yourNeedAfter[pos]);
  }, 0);

  let verdict: TradeEvaluation["verdict"] = "fair";
  if (rosDelta >= 15 && needImprovement >= 0) verdict = "accept";
  else if (rosDelta >= 5 || (rosDelta >= -5 && needImprovement > 0)) verdict = "lean_accept";
  else if (rosDelta <= -15 && needImprovement <= 0) verdict = "reject";
  else if (rosDelta <= -5) verdict = "lean_reject";

  const rationaleParts = [
    `ROS points: you give ${giveRos.toFixed(1)}, get ${getRos.toFixed(1)} (Δ ${rosDelta >= 0 ? "+" : ""}${rosDelta.toFixed(1)}).`,
    `This week: give ${giveWeek.toFixed(1)}, get ${getWeek.toFixed(1)}.`,
  ];
  if (needImprovement > 0) rationaleParts.push("Trade improves your positional depth/need.");
  if (needImprovement < 0) rationaleParts.push("Trade worsens your positional balance.");
  rationaleParts.push(`Verdict: ${verdict.replace("_", " ")}.`);

  return {
    give: params.give,
    get: params.get,
    giveRos,
    getRos,
    rosDelta,
    giveWeek,
    getWeek,
    yourNeedBefore,
    yourNeedAfter,
    theirNeedBefore,
    theirNeedAfter,
    verdict,
    rationale: rationaleParts.join(" "),
  };
}
