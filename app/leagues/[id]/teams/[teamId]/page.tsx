import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchTeamRosterPage } from "@/lib/league/player-data";
import { LeagueNav } from "@/components/league/league-nav";
import { RosterLineupTable } from "@/components/league/roster-lineup-table";
import { LeagueSyncButtons } from "@/components/league/league-sync-buttons";

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
    <div className="mx-auto max-w-6xl px-4 py-8 pb-16">
      <p className="mb-2 text-sm text-slate-500">
        <Link href={`/leagues/${leagueId}`} className="hover:text-slate-300">
          League
        </Link>
        {" / "}
        Team
      </p>
      <LeagueNav leagueId={leagueId} current="overview" />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{page.team.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {page.team.wins}-{page.team.losses}-{page.team.ties}
            {page.team.points_for != null ? ` · ${Number(page.team.points_for).toFixed(1)} PF` : ""}
            {page.team.is_user_team ? " · your team" : ""}
            {page.currentWeek != null ? ` · NFL week ${page.currentWeek}` : ""}
          </p>
        </div>
        <LeagueSyncButtons leagueId={leagueId} />
      </div>

      <RosterLineupTable
        leagueId={leagueId}
        currentWeek={page.currentWeek}
        irSlotCount={page.irSlotCount}
        players={page.players}
      />
    </div>
  );
}
