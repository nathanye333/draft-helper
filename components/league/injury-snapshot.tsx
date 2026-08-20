import { HealthStatus } from "@/components/league/roster-lineup-table";
import { PlayerLink } from "@/components/league/entity-links";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InjuryBoardPlayer } from "@/lib/news/types";

function scopeLabel(scope: InjuryBoardPlayer["scope"]): string {
  switch (scope) {
    case "opponent":
      return "Opponent";
    case "watchlist":
      return "Watchlist";
    default:
      return "Roster";
  }
}

export function InjurySnapshot({
  leagueId,
  players,
}: {
  leagueId: string;
  players: InjuryBoardPlayer[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Injury board</CardTitle>
      </CardHeader>
      <CardContent>
        {players.length === 0 ? (
          <p className="text-sm text-slate-400">No injury flags on scoped players.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                  <th className="px-2 py-2 font-medium">Player</th>
                  <th className="px-2 py-2 font-medium">Slot</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Change</th>
                  <th className="px-2 py-2 font-medium">Scope</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.espnPlayerId} className="border-b border-slate-900/80">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                          {p.headshotUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.headshotUrl} alt="" className="h-full w-full object-cover object-top" />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                              {p.name.slice(0, 1)}
                            </span>
                          )}
                        </span>
                        <div>
                          <PlayerLink leagueId={leagueId} espnPlayerId={p.espnPlayerId}>
                            {p.name}
                          </PlayerLink>
                          <p className="text-xs text-slate-500">
                            {p.nflTeam ?? "—"} · {p.position}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-slate-300">{p.lineupSlot}</td>
                    <td className="px-2 py-2">
                      <HealthStatus status={p.injuryStatus} />
                    </td>
                    <td className="px-2 py-2 text-xs text-amber-300">
                      {p.delta ? (
                        <span>
                          {p.delta.fromStatus ?? "—"} → {p.delta.toStatus}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={p.isStarter ? "warning" : "default"}>{scopeLabel(p.scope)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
