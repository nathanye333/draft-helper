import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, userTeam } from "@/lib/league/data";
import { LeagueNav } from "@/components/league/league-nav";
import { LeagueSyncButtons } from "@/components/league/league-sync-buttons";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function LeagueOverviewPage({
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
  const myRoster = mine
    ? bundle.rosterEntries.filter((r) => r.espn_team_id === mine.espn_team_id)
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{bundle.league.name}</h1>
          <p className="text-sm text-slate-400">
            {bundle.league.season} · {bundle.league.scoring}
            {bundle.league.current_week != null ? ` · Week ${bundle.league.current_week}` : ""}
          </p>
        </div>
        <LeagueSyncButtons leagueId={id} />
      </div>

      <LeagueNav leagueId={id} current="overview" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Standings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[...bundle.teams]
              .sort((a, b) => (b.wins - a.wins) || (b.points_for ?? 0) - (a.points_for ?? 0))
              .map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <span className={t.is_user_team ? "font-medium text-emerald-300" : ""}>
                    {t.name}
                  </span>
                  <span className="text-slate-400">
                    {t.wins}-{t.losses}-{t.ties}
                  </span>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{mine ? `${mine.name} roster` : "Your roster"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {myRoster.length === 0 ? (
              <p className="text-slate-500">No roster yet — sync ESPN.</p>
            ) : (
              myRoster.map((r) => {
                const proj = r.fp_player_id
                  ? bundle.projectionsByFpId.get(r.fp_player_id)
                  : undefined;
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{r.player_name}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {r.position}
                        {r.nfl_team ? ` · ${r.nfl_team}` : ""}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="default">{r.lineup_slot}</Badge>
                      <span className="w-14 text-right text-xs text-slate-400">
                        {proj?.week != null ? proj.week.toFixed(1) : "—"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {!bundle.hasCredentials ? (
        <p className="mt-4 text-sm text-amber-400">
          ESPN credentials missing — reconnect from Connect ESPN.
        </p>
      ) : null}

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
