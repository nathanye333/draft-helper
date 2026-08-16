import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, rosterSlotsFromLeague, userTeam } from "@/lib/league/data";
import { LeagueNav } from "@/components/league/league-nav";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { TradeAnalyzerClient } from "@/components/league/trade-analyzer-client";

export default async function TradesPage({
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
  if (!mine) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Trade analyzer</h1>
        <p className="mt-2 text-sm text-slate-400">Mark your team and sync ESPN first.</p>
        <LeagueNav leagueId={id} current="trades" />
      </div>
    );
  }

  const projectionsByFpId: Record<string, { week: number | null; ros: number | null }> = {};
  for (const [fp, v] of bundle.projectionsByFpId) {
    projectionsByFpId[fp] = v;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Trade analyzer</h1>
      <p className="mb-4 text-sm text-slate-400">
        ROS and weekly FantasyPros projections + positional need
      </p>
      <LeagueNav leagueId={id} current="trades" />
      <TradeAnalyzerClient
        yourTeam={mine}
        teams={bundle.teams}
        yourRoster={bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id)}
        allRosters={bundle.rosterEntries}
        projectionsByFpId={projectionsByFpId}
        rosterSlots={rosterSlotsFromLeague(bundle.league)}
      />
      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
