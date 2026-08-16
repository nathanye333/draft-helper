import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLeagueBundle } from "@/lib/league/data";
import { LeagueNav } from "@/components/league/league-nav";
import { SeasonAgentSection } from "@/components/league/season-agent-section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * News triage wrapper shell — full product behavior deferred until specified.
 */
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">News triage</h1>
      <p className="mb-4 text-sm text-slate-400">
        Wrapper page — triage workflow coming next
      </p>
      <LeagueNav leagueId={id} current="news" />

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-400">
          <p>
            This page will surface injury and news signals for your roster and watchlist,
            then help you decide who to start, stash, or drop.
          </p>
          <p>
            For now, use the season agent (bottom-right) with questions like “any injury
            news for my RBs?” — it can call web search against your synced roster.
          </p>
        </CardContent>
      </Card>

      <SeasonAgentSection leagueId={id} />
    </div>
  );
}
