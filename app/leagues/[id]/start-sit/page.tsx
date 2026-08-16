import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, rosterSlotsFromLeague, userTeam } from "@/lib/league/data";
import { suggestStartSit } from "@/lib/analytics/start-sit";
import { LeagueNav } from "@/components/league/league-nav";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function StartSitPage({
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
  const roster = mine
    ? bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id)
    : [];

  const weekProj = new Map<string, number | null>();
  for (const [fp, v] of bundle.projectionsByFpId) weekProj.set(fp, v.week);

  const suggestion = suggestStartSit({
    roster,
    rosterSlots: rosterSlotsFromLeague(bundle.league),
    weekProjByFpId: weekProj,
  });

  const opp = mine
    ? bundle.matchups.find(
        (m) =>
          m.home_espn_team_id === mine.espn_team_id ||
          m.away_espn_team_id === mine.espn_team_id,
      )
    : undefined;
  let opponentName: string | null = null;
  if (opp && mine) {
    const oppId =
      opp.home_espn_team_id === mine.espn_team_id
        ? opp.away_espn_team_id
        : opp.home_espn_team_id;
    opponentName = bundle.teams.find((t) => t.espn_team_id === oppId)?.name ?? null;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Start / Sit</h1>
      <p className="mb-4 text-sm text-slate-400">
        Week {bundle.league.current_week ?? "—"}
        {opponentName ? ` vs ${opponentName}` : ""} · projected starters{" "}
        {suggestion.projectedStarterPoints.toFixed(1)} pts
      </p>
      <LeagueNav leagueId={id} current="start-sit" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Suggested starters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {suggestion.starters.map((p) => (
              <div key={p.espnPlayerId} className="flex justify-between gap-2">
                <span>
                  <span className="text-xs text-slate-500">{p.currentSlot}</span>{" "}
                  {p.name}
                </span>
                <span className="text-slate-400">
                  {p.weekProj != null ? p.weekProj.toFixed(1) : "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bench</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {suggestion.bench.map((p) => (
              <div key={p.espnPlayerId} className="flex justify-between gap-2">
                <span>{p.name}</span>
                <span className="text-slate-400">
                  {p.weekProj != null ? p.weekProj.toFixed(1) : "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {suggestion.notes.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-400">
          {suggestion.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
