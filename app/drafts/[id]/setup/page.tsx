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
          <SyncRankingsPanel draftId={bundle.draft.id} initialRankings={bundle.rankings} />
        </CardContent>
      </Card>
    </div>
  );
}
