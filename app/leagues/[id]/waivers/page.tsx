import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchWaiverPool } from "@/lib/league/player-data";
import { LeagueNav } from "@/components/league/league-nav";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { LeagueSyncButtons } from "@/components/league/league-sync-buttons";
import { WaiversTable } from "@/components/league/waivers-table";

export default async function WaiversPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: league } = await supabase.from("leagues").select("id").eq("id", id).maybeSingle();
  if (!league) notFound();

  const pool = await fetchWaiverPool(id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-28">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Players</h1>
          <p className="mt-1 text-sm text-slate-400">
            Free agents &amp; waivers · ESPN projections (read-only — no add/drop)
          </p>
        </div>
        <LeagueSyncButtons leagueId={id} />
      </div>
      <LeagueNav leagueId={id} current="waivers" />

      <WaiversTable
        leagueId={id}
        currentWeek={pool.currentWeek}
        season={pool.season}
        players={pool.players}
      />

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
