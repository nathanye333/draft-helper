"use client";

import { useMemo, useState } from "react";
import { evaluateTrade } from "@/lib/analytics/trade";
import type { LeagueRosterEntry, LeagueTeam, SlotType } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type ProjMap = Record<string, { week: number | null; ros: number | null }>;

export function TradeAnalyzerClient({
  yourTeam,
  teams,
  yourRoster,
  allRosters,
  projectionsByFpId,
  rosterSlots,
}: {
  yourTeam: LeagueTeam;
  teams: LeagueTeam[];
  yourRoster: LeagueRosterEntry[];
  allRosters: LeagueRosterEntry[];
  projectionsByFpId: ProjMap;
  rosterSlots: { slot_type: SlotType; count: number }[];
}) {
  const opponents = teams.filter((t) => t.espn_team_id !== yourTeam.espn_team_id);
  const [theirId, setTheirId] = useState(opponents[0]?.espn_team_id ?? 0);
  const [giveIds, setGiveIds] = useState<number[]>([]);
  const [getIds, setGetIds] = useState<number[]>([]);

  const theirRoster = useMemo(
    () => allRosters.filter((r) => r.espn_team_id === theirId),
    [allRosters, theirId],
  );

  function toSide(ids: number[], roster: LeagueRosterEntry[]) {
    return ids
      .map((id) => {
        const row = roster.find((r) => r.espn_player_id === id);
        if (!row) return null;
        const proj = row.fp_player_id ? projectionsByFpId[row.fp_player_id] : undefined;
        return {
          espnPlayerId: row.espn_player_id,
          name: row.player_name,
          position: row.position,
          rosProj: proj?.ros ?? null,
          weekProj: proj?.week ?? null,
        };
      })
      .filter(Boolean) as {
      espnPlayerId: number;
      name: string;
      position: string;
      rosProj: number | null;
      weekProj: number | null;
    }[];
  }

  const evaluation =
    giveIds.length > 0 && getIds.length > 0
      ? evaluateTrade({
          yourRoster,
          theirRoster,
          give: toSide(giveIds, yourRoster),
          get: toSide(getIds, theirRoster),
          yourEspnTeamId: yourTeam.espn_team_id,
          theirEspnTeamId: theirId,
          rosterSlots,
        })
      : null;

  function toggle(list: number[], id: number, set: (v: number[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, 6));
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="opp">Trade partner</Label>
        <select
          id="opp"
          className="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          value={theirId}
          onChange={(e) => {
            setTheirId(Number(e.target.value));
            setGetIds([]);
          }}
        >
          {opponents.map((t) => (
            <option key={t.espn_team_id} value={t.espn_team_id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>You give</CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {yourRoster.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={giveIds.includes(r.espn_player_id)}
                  onChange={() => toggle(giveIds, r.espn_player_id, setGiveIds)}
                />
                <span>
                  {r.player_name}{" "}
                  <span className="text-xs text-slate-500">{r.position}</span>
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>You get</CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {theirRoster.map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={getIds.includes(r.espn_player_id)}
                  onChange={() => toggle(getIds, r.espn_player_id, setGetIds)}
                />
                <span>
                  {r.player_name}{" "}
                  <span className="text-xs text-slate-500">{r.position}</span>
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
      </div>

      {evaluation ? (
        <Card>
          <CardHeader>
            <CardTitle>Evaluation · {evaluation.verdict.replace(/_/g, " ")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-300">
            <p>{evaluation.rationale}</p>
            <p className="text-slate-400">
              ROS Δ {evaluation.rosDelta >= 0 ? "+" : ""}
              {evaluation.rosDelta.toFixed(1)} · Week Δ{" "}
              {(evaluation.getWeek - evaluation.giveWeek).toFixed(1)}
            </p>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-slate-500">Select players on both sides to evaluate.</p>
      )}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setGiveIds([]);
          setGetIds([]);
        }}
      >
        Clear
      </Button>
    </div>
  );
}
