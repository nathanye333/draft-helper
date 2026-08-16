import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPlayerCard } from "@/lib/league/player-data";
import { LeagueNav } from "@/components/league/league-nav";
import { TeamLink } from "@/components/league/entity-links";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function WeekTable({
  title,
  rows,
}: {
  title: string;
  rows: { week: number; actual_points: number | null; projected_points: number | null }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-500">No weekly data cached yet. Sync ESPN.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-950 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Week</th>
                  <th className="px-4 py-2 text-right font-medium">Actual</th>
                  <th className="px-4 py-2 text-right font-medium">Projected</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.week} className="border-t border-slate-900">
                    <td className="px-4 py-1.5">{r.week}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      {r.actual_points != null ? r.actual_points.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-400">
                      {r.projected_points != null ? r.projected_points.toFixed(1) : "—"}
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

export default async function PlayerCardPage({
  params,
}: {
  params: Promise<{ id: string; playerId: string }>;
}) {
  const { id: leagueId, playerId: playerIdRaw } = await params;
  const espnPlayerId = Number(playerIdRaw);
  if (!Number.isFinite(espnPlayerId)) notFound();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const card = await fetchPlayerCard(leagueId, espnPlayerId);
  if (!card) notFound();

  const { player, pool } = card;
  const headshot =
    player.headshot_url ||
    `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnPlayerId}.png&w=350&h=254`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-16">
      <p className="mb-2 text-sm text-slate-500">
        <Link href={`/leagues/${leagueId}`} className="hover:text-slate-300">
          League
        </Link>
        {" / "}
        Player
      </p>
      <LeagueNav leagueId={leagueId} current="overview" />

      <div className="mb-6 flex flex-wrap items-start gap-5">
        <div className="h-28 w-36 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={headshot} alt={player.name} className="h-full w-full object-cover object-top" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{player.name}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{player.position}</Badge>
            {player.nfl_team ? <Badge variant="default">{player.nfl_team}</Badge> : null}
            {pool?.injury_status ? <Badge variant="warning">{pool.injury_status}</Badge> : null}
          </div>
          <p className="mt-3 text-sm text-slate-300">
            Fantasy team:{" "}
            {card.fantasyTeam ? (
              <TeamLink leagueId={leagueId} espnTeamId={card.fantasyTeam.espn_team_id}>
                {card.fantasyTeam.name}
              </TeamLink>
            ) : (
              <span className="text-slate-400">{card.ownershipLabel}</span>
            )}
          </p>
          {pool?.percent_owned != null ? (
            <p className="text-xs text-slate-500">{pool.percent_owned.toFixed(1)}% rostered (ESPN)</p>
          ) : null}
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-slate-500">ESPN week proj</p>
            <p className="text-xl tabular-nums">
              {pool?.week_projected != null ? pool.week_projected.toFixed(1) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-slate-500">ESPN season actual</p>
            <p className="text-xl tabular-nums">
              {pool?.season_actual != null ? pool.season_actual.toFixed(1) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-slate-500">FP week proj</p>
            <p className="text-xl tabular-nums">
              {card.fpWeekProj != null ? card.fpWeekProj.toFixed(1) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-slate-500">FP ROS</p>
            <p className="text-xl tabular-nums">
              {card.fpRosProj != null ? card.fpRosProj.toFixed(1) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <WeekTable title="This season (ESPN, week-by-week)" rows={card.thisYearWeeks} />
        <WeekTable title="Last season (ESPN, week-by-week)" rows={card.lastYearWeeks} />
      </div>
    </div>
  );
}
