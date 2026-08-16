import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchTeamRosterPage } from "@/lib/league/player-data";
import { LeagueNav } from "@/components/league/league-nav";
import { PlayerLink } from "@/components/league/entity-links";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ id: string; teamId: string }>;
}) {
  const { id: leagueId, teamId: teamIdRaw } = await params;
  const espnTeamId = Number(teamIdRaw);
  if (!Number.isFinite(espnTeamId)) notFound();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const page = await fetchTeamRosterPage(leagueId, espnTeamId);
  if (!page) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-16">
      <p className="mb-2 text-sm text-slate-500">
        <Link href={`/leagues/${leagueId}`} className="hover:text-slate-300">
          League
        </Link>
        {" / "}
        Team
      </p>
      <LeagueNav leagueId={leagueId} current="overview" />

      <h1 className="mb-1 text-2xl font-semibold">{page.team.name}</h1>
      <p className="mb-6 text-sm text-slate-400">
        {page.team.wins}-{page.team.losses}-{page.team.ties}
        {page.team.points_for != null ? ` · ${page.team.points_for.toFixed(1)} PF` : ""}
        {page.team.is_user_team ? " · your team" : ""}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Roster ({page.players.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {page.players.map((p) => (
            <div
              key={p.espnPlayerId}
              className="flex items-center gap-3 border-b border-slate-900/80 py-2 last:border-0"
            >
              <div className="h-10 w-12 shrink-0 overflow-hidden rounded bg-slate-900">
                {p.headshotUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.headshotUrl}
                    alt=""
                    className="h-full w-full object-cover object-top"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <PlayerLink leagueId={leagueId} espnPlayerId={p.espnPlayerId} className="font-medium">
                  {p.name}
                </PlayerLink>
                <div className="text-xs text-slate-500">
                  {p.position}
                  {p.nflTeam ? ` · ${p.nflTeam}` : ""}
                  {p.injuryStatus ? ` · ${p.injuryStatus}` : ""}
                </div>
              </div>
              <Badge variant="default">{p.lineupSlot}</Badge>
              <div className="w-16 text-right text-xs tabular-nums text-slate-400">
                {p.weekProjected != null ? p.weekProjected.toFixed(1) : "—"}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
