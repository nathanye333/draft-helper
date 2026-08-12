import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fetchDraftBundle } from "@/lib/draft/data";
import { ValueLabelBadge } from "@/components/value-label-badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function DraftBoardPage({ params }: PageProps<"/drafts/[id]/board">) {
  const { id } = await params;
  const bundle = await fetchDraftBundle(id);
  if (!bundle) notFound();
  if (bundle.draft.status === "setup") redirect(`/drafts/${id}/setup`);

  const totalRounds = Math.max(
    1,
    bundle.rosterSlots.reduce((sum, s) => sum + s.count, 0),
    ...bundle.picks.map((p) => p.round),
  );

  const pickByRoundAndTeam = new Map(
    bundle.picks.map((p) => [`${p.round}-${p.team_id}`, p]),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{bundle.draft.name} · Draft board</h1>
        <div className="flex items-center gap-3">
          <Link href={`/drafts/${id}`} className="text-sm text-slate-300 hover:text-slate-100">
            Draft room
          </Link>
          <Link href={`/drafts/${id}/analysis`} className="text-sm text-slate-300 hover:text-slate-100">
            Analysis
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-slate-900 p-2 text-left text-xs font-medium text-slate-500">
                  Rd
                </th>
                {bundle.teams.map((team) => (
                  <th key={team.id} className="min-w-[140px] border-l border-slate-800 p-2 text-left text-xs font-medium text-slate-300">
                    {team.name}
                    {team.is_user_team ? " (you)" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => (
                <tr key={round} className="border-t border-slate-800">
                  <td className="sticky left-0 bg-slate-950 p-2 text-xs text-slate-500">{round}</td>
                  {bundle.teams.map((team) => {
                    const pick = pickByRoundAndTeam.get(`${round}-${team.id}`);
                    return (
                      <td key={team.id} className="border-l border-slate-800 p-2 align-top">
                        {pick ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-slate-500">#{pick.pick_number}</span>
                            <span className="text-sm text-slate-100">{pick.players.name}</span>
                            <span className="text-xs text-slate-500">
                              {pick.players.position} · {pick.assigned_slot_type}
                            </span>
                            <ValueLabelBadge adpDelta={pick.adp_delta} />
                          </div>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
