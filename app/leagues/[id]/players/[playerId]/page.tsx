import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchPlayerCard } from "@/lib/league/player-data";
import { LeagueNav } from "@/components/league/league-nav";
import { TeamLink } from "@/components/league/entity-links";
import { HealthStatus } from "@/components/league/roster-lineup-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  const { data: league } = await supabase
    .from("leagues")
    .select("season, current_week, scoring")
    .eq("id", leagueId)
    .single();

  const card = await fetchPlayerCard(leagueId, espnPlayerId);
  if (!card) notFound();

  const { player, pool } = card;
  const headshot =
    player.headshot_url ??
    `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${espnPlayerId}.png&w=350&h=254`;
  const weekProj = pool?.week_projected ?? card.fpWeekProj;

  const seasonAvg =
    pool?.season_projected != null ? pool.season_projected / 17 : null;
  const lastYearTotal = card.lastYearWeeks.reduce(
    (s, w) => s + (w.actual_points ?? 0),
    0,
  );
  const lastYearGames = card.lastYearWeeks.filter((w) => w.actual_points != null).length;

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

      {/* Header card */}
      <Card className="mb-4 overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-wrap gap-0">
            <div className="flex min-w-0 flex-1 flex-wrap gap-4 p-5">
              <div className="h-28 w-36 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={headshot}
                  alt={player.name}
                  className="h-full w-full object-cover object-top"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
                    {player.name}
                  </h1>
                  <p className="text-sm text-slate-400">
                    {player.nfl_team ?? "Free agent"}
                    {player.position ? ` · ${player.position}` : ""}
                  </p>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-[4.5rem_1fr]">
                  <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Elig
                  </dt>
                  <dd className="text-slate-200">{player.position}</dd>
                  <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Manager
                  </dt>
                  <dd>
                    {card.fantasyTeam ? (
                      <TeamLink leagueId={leagueId} espnTeamId={card.fantasyTeam.espn_team_id}>
                        {card.fantasyTeam.name}
                      </TeamLink>
                    ) : (
                      <span className="text-slate-400">{card.ownershipLabel}</span>
                    )}
                  </dd>
                  <dt className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                    Status
                  </dt>
                  <dd>
                    <HealthStatus status={pool?.injury_status ?? null} />
                  </dd>
                </dl>
              </div>
            </div>

            <div className="w-full border-t border-slate-800 sm:w-52 sm:border-t-0 sm:border-l">
              <div className="divide-y divide-slate-800 text-sm">
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    Season proj
                  </p>
                  <p className="mt-0.5 text-lg tabular-nums text-slate-100">
                    {pool?.season_projected != null ? pool.season_projected.toFixed(1) : "—"}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    Average points
                  </p>
                  <p className="mt-0.5 text-lg tabular-nums text-slate-100">
                    {seasonAvg != null ? seasonAvg.toFixed(1) : "—"}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    % Rostered
                  </p>
                  <p className="mt-0.5 text-lg tabular-nums text-slate-100">
                    {pool?.percent_owned != null ? `${pool.percent_owned.toFixed(1)}%` : "—"}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    % Started
                  </p>
                  <p className="mt-0.5 text-lg tabular-nums text-slate-100">
                    {pool?.percent_started != null ? `${pool.percent_started.toFixed(1)}%` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats summary */}
      <Card className="mb-4">
        <CardHeader className="flex-row items-center justify-between border-b border-slate-800 py-3">
          <CardTitle>Stats</CardTitle>
          <span className="text-xs text-slate-500">ESPN fantasy points · {league?.scoring}</span>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-[10px] tracking-wide text-slate-500 uppercase">
              <tr className="border-b border-slate-800">
                <th className="px-4 py-2 text-left font-semibold" />
                <th className="px-3 py-2 text-right font-semibold">
                  Week {league?.current_week ?? "—"} Proj
                </th>
                <th className="px-3 py-2 text-right font-semibold">Season Proj</th>
                <th className="px-3 py-2 text-right font-semibold">Season Act</th>
                <th className="px-4 py-2 text-right font-semibold">FP ROS</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-900">
                <td className="px-4 py-2.5 text-slate-300">
                  {league?.season ?? ""} Projected
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {weekProj != null ? weekProj.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {pool?.season_projected != null ? pool.season_projected.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">—</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {card.fpRosProj != null ? card.fpRosProj.toFixed(1) : "—"}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-slate-300">
                  {(league?.season ?? 1) - 1} Season
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">—</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">—</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {lastYearGames > 0 ? lastYearTotal.toFixed(1) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">—</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Outlook / projection callout */}
      <Card className="mb-4">
        <CardHeader className="border-b border-slate-800 py-3">
          <CardTitle>Outlook</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {league?.season} projection
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-50">
            {pool?.season_projected != null ? (
              <>
                {pool.season_projected.toFixed(1)}{" "}
                <span className="text-lg font-normal text-slate-400">points</span>
              </>
            ) : (
              "—"
            )}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Cached ESPN fantasy scoring for this league
            {league?.scoring ? ` (${league.scoring})` : ""}. Week projection uses the current
            matchup period
            {league?.current_week != null ? ` (week ${league.current_week})` : ""}. Last season
            totals come from ESPN week-by-week actuals when available after sync.
            {card.fpWeekProj != null || card.fpRosProj != null
              ? " FantasyPros week/ROS figures are shown alongside when the player is ID-mapped."
              : ""}
          </p>
        </CardContent>
      </Card>

      {/* Game logs */}
      <div className="grid gap-4 md:grid-cols-2">
        <GameLogCard title={`${league?.season ?? "This"} game log`} rows={card.thisYearWeeks} />
        <GameLogCard
          title={`${(league?.season ?? 1) - 1} game log`}
          rows={card.lastYearWeeks}
        />
      </div>
    </div>
  );
}

function GameLogCard({
  title,
  rows,
}: {
  title: string;
  rows: { week: number; actual_points: number | null; projected_points: number | null }[];
}) {
  return (
    <Card>
      <CardHeader className="border-b border-slate-800 py-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No weekly data yet — sync ESPN.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-950 text-[10px] tracking-wide text-slate-500 uppercase">
                <tr className="border-b border-slate-800">
                  <th className="px-4 py-2 text-left font-semibold">Week</th>
                  <th className="px-3 py-2 text-right font-semibold">Proj</th>
                  <th className="px-4 py-2 text-right font-semibold">FPTS</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.week} className="border-b border-slate-900/80">
                    <td className="px-4 py-1.5 text-slate-300">{r.week}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                      {r.projected_points != null ? r.projected_points.toFixed(1) : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      {r.actual_points != null ? r.actual_points.toFixed(1) : "—"}
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
