import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle, userTeam } from "@/lib/league/data";
import { buildInjuryBoard } from "@/lib/news/injury-board";
import { loadRosterScope } from "@/lib/news/roster-scope";
import { LeagueNav } from "@/components/league/league-nav";
import { LeagueSyncButtons } from "@/components/league/league-sync-buttons";
import { InjurySnapshot } from "@/components/league/injury-snapshot";
import { NewsTriageBoard } from "@/components/league/news-triage-board";
import { NewsEmailPrefs } from "@/components/league/news-email-prefs";
import { SeasonAgentSection } from "@/components/league/season-agent-section";

export default async function NewsPage({
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

  const scope = await loadRosterScope(id);
  const injuryBoard = scope ? buildInjuryBoard(scope.players, scope.injuryDeltas) : [];
  const mine = userTeam(bundle);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-semibold">News triage</h1>
          <p className="text-sm text-slate-400">
            Injury, trade, boom/bust, and standout headlines for{" "}
            {mine ? "your roster" : "this league"}, plus watchlist and matchup opponents.
          </p>
        </div>
        <LeagueSyncButtons leagueId={id} />
      </div>
      <LeagueNav leagueId={id} current="news" />

      <div className="mt-6 space-y-6">
        <NewsEmailPrefs leagueId={id} />
        <InjurySnapshot leagueId={id} players={injuryBoard} />
        <NewsTriageBoard leagueId={id} />
      </div>

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
