import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  fetchFreeAgents,
  fetchLeagueBundle,
  rosterSlotsFromLeague,
  userTeam,
} from "@/lib/league/data";
import { rankWaiverTargets } from "@/lib/analytics/waivers";
import { LeagueNav } from "@/components/league/league-nav";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { LeagueSyncButtons } from "@/components/league/league-sync-buttons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function WaiversPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const bundle = await fetchLeagueBundle(id);
  if (!bundle) notFound();
  const mine = userTeam(bundle);
  const projectionWeek =
    bundle.league.current_week != null && bundle.league.current_week > 0
      ? bundle.league.current_week
      : null;

  const fas = await fetchFreeAgents({
    leagueId: id,
    season: bundle.league.season,
    scoring: bundle.league.scoring,
    week: bundle.league.current_week,
    limit: 150,
  });

  const targets = mine
    ? rankWaiverTargets({
        freeAgents: fas,
        yourRoster: bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id),
        rosterSlots: rosterSlotsFromLeague(bundle.league),
        limit: 60,
      })
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Waiver / FA targets</h1>
          <p className="mt-1 text-sm text-slate-400">
            FantasyPros projections ({bundle.league.scoring}
            {projectionWeek != null ? ` · NFL week ${projectionWeek}` : " · season/ROS only"}
            ). Players already on any ESPN roster are excluded.
          </p>
        </div>
        <LeagueSyncButtons leagueId={id} />
      </div>
      <LeagueNav leagueId={id} current="waivers" />

      <Card>
        <CardHeader>
          <CardTitle>Top available ({targets.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {targets.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-slate-500">
              No free-agent projections yet. Sync ESPN (rosters) then Sync projections.
            </p>
          ) : (
            <div className="max-h-[min(70vh,720px)] overflow-y-auto overscroll-contain">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
                  <tr className="text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">Player</th>
                    <th className="px-2 py-2 font-medium">Pos</th>
                    <th className="px-2 py-2 text-right font-medium">
                      {projectionWeek != null ? `FP W${projectionWeek}` : "FP week"}
                    </th>
                    <th className="px-2 py-2 text-right font-medium">FP ROS</th>
                    <th className="px-4 py-2 text-right font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.fpPlayerId} className="border-b border-slate-900/80 hover:bg-slate-900/40">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-100">{t.name}</div>
                        <div className="text-xs text-slate-500">
                          {t.nflTeam ?? "FA"}
                          {t.needScore > 0 ? ` · fills ${t.position} need` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-slate-400">{t.position}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                        {t.weekProj != null ? t.weekProj.toFixed(1) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                        {t.rosProj != null ? t.rosProj.toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                        {t.score.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
