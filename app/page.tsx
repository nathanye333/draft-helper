import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteDraftButton } from "@/components/draft-list/delete-draft-button";
import { DeleteLeagueButton } from "@/components/league/delete-league-button";
import { HubRoutePrefetch } from "@/components/hub-route-prefetch";
import type { Draft, League } from "@/lib/supabase/types";

const STATUS_VARIANT: Record<Draft["status"], "default" | "success" | "warning"> = {
  setup: "warning",
  live: "success",
  complete: "default",
};

const STATUS_HREF: Record<Draft["status"], (id: string) => string> = {
  setup: (id) => `/drafts/${id}/setup`,
  live: (id) => `/drafts/${id}`,
  complete: (id) => `/drafts/${id}/analysis`,
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect("/login");
  }

  const [{ data: drafts }, { data: leagues }] = await Promise.all([
    supabase.from("drafts").select("*").order("created_at", { ascending: false }),
    supabase.from("leagues").select("*").order("updated_at", { ascending: false }),
  ]);

  const typedLeagues = (leagues ?? []) as League[];
  const typedDrafts = (drafts ?? []) as Draft[];
  const syncedLeagueIds = typedLeagues
    .filter((l) => l.last_synced_at)
    .slice(0, 3)
    .map((l) => l.id);
  const draftHrefs = typedDrafts.slice(0, 5).map((d) => STATUS_HREF[d.status](d.id));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <HubRoutePrefetch syncedLeagueIds={syncedLeagueIds} draftHrefs={draftHrefs} />
      <div className="mb-10">
        <h1 className="text-2xl font-semibold">Fantasy helper</h1>
        <p className="mt-1 text-sm text-slate-400">
          Draft night tools and season-long ESPN advisor
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/drafts/new" className={buttonVariants()}>
            New draft
          </Link>
          <Link href="/leagues/new" className={buttonVariants({ variant: "secondary" })}>
            Connect ESPN league
          </Link>
          <Link href="/leagues" className={buttonVariants({ variant: "ghost" })}>
            All leagues
          </Link>
        </div>
      </div>

      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Season leagues</h2>
          <Link href="/leagues" className="text-sm text-slate-400 hover:text-slate-200">
            View all
          </Link>
        </div>
        {!typedLeagues.length ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-400">
              No ESPN leagues yet. Connect with SWID / espn_s2 cookies.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {typedLeagues.slice(0, 5).map((league) => (
              <Card key={league.id} className="transition-colors hover:border-slate-700">
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <Link href={`/leagues/${league.id}`} className="min-w-0 flex-1">
                    <CardTitle>{league.name}</CardTitle>
                    <p className="text-sm text-slate-400">
                      {league.season} · {league.scoring}
                      {league.current_week != null ? ` · Week ${league.current_week}` : ""}
                    </p>
                  </Link>
                  <DeleteLeagueButton leagueId={league.id} leagueName={league.name} />
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Drafts</h2>
          <Link href="/drafts/new" className="text-sm text-slate-400 hover:text-slate-200">
            New draft
          </Link>
        </div>
        {!typedDrafts.length ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-slate-400">
              No drafts yet. Create one to configure your league and sync rankings.
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {typedDrafts.map((draft) => (
              <Card key={draft.id} className="transition-colors hover:border-slate-700">
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <Link href={STATUS_HREF[draft.status](draft.id)} className="min-w-0 flex-1">
                    <CardTitle>{draft.name}</CardTitle>
                    <p className="text-sm text-slate-400">
                      {draft.season} · {draft.num_teams} teams · {draft.scoring}
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={STATUS_VARIANT[draft.status]}>{draft.status}</Badge>
                    <DeleteDraftButton draftId={draft.id} draftName={draft.name} />
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
