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
        limit: 40,
      })
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Waiver / FA targets</h1>
      <p className="mb-4 text-sm text-slate-400">
        Ranked by weekly + ROS projections and your roster need
      </p>
      <LeagueNav leagueId={id} current="waivers" />

      <Card>
        <CardHeader>
          <CardTitle>Top available</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {targets.length === 0 ? (
            <p className="text-slate-500">
              No free-agent projections yet. Sync ESPN and FantasyPros projections.
            </p>
          ) : (
            targets.map((t) => (
              <div key={t.fpPlayerId} className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    {t.position}
                    {t.nflTeam ? ` · ${t.nflTeam}` : ""}
                  </span>
                  <p className="text-xs text-slate-500">{t.rationale}</p>
                </div>
                <span className="shrink-0 text-slate-400">{t.score.toFixed(1)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
