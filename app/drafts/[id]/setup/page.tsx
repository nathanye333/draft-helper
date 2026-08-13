import { notFound, redirect } from "next/navigation";
import { fetchDraftBundle } from "@/lib/draft/data";
import { SyncRankingsPanel } from "@/components/setup-wizard/sync-rankings-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DraftSetupPage({ params }: PageProps<"/drafts/[id]/setup">) {
  const { id } = await params;
  const bundle = await fetchDraftBundle(id);
  if (!bundle) notFound();

  if (bundle.draft.status !== "setup") {
    redirect(bundle.draft.status === "live" ? `/drafts/${id}` : `/drafts/${id}/analysis`);
  }

  const topByAdp = [...bundle.rankings]
    .filter((r) => r.rank_adp != null)
    .sort((a, b) => (a.rank_adp ?? Infinity) - (b.rank_adp ?? Infinity))
    .slice(0, 10)
    .map((r) => ({
      fpPlayerId: r.fp_player_id,
      rankAdp: r.rank_adp as number,
      name: r.players.name,
      position: r.players.position,
      nflTeam: r.players.nfl_team,
    }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">{bundle.draft.name}</h1>
      <p className="mb-6 text-sm text-slate-400">
        {bundle.draft.season} · {bundle.teams.length} teams · {bundle.draft.scoring}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Sync rankings</CardTitle>
          <CardDescription>
            Pull FantasyPros consensus ADP/ECR so picks can be graded as reaches, fair, or steals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SyncRankingsPanel
            draftId={bundle.draft.id}
            rankingCount={bundle.rankings.length}
            topByAdp={topByAdp}
          />
        </CardContent>
      </Card>
    </div>
  );
}
