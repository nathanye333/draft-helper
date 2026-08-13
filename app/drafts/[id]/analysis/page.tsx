import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fetchDraftBundle } from "@/lib/draft/data";
import { computeDraftState, toAvailablePlayerVMs } from "@/lib/draft/view";
import { computePositionScarcity } from "@/lib/analytics/scarcity";
import { computeRecommendations } from "@/lib/analytics/recommendations";
import { ValueLabelBadge } from "@/components/value-label-badge";
import { ScarcityAlerts } from "@/components/analysis/scarcity-alerts";
import { RecommendationsPanel } from "@/components/draft-room/recommendations-panel";
import { toRecommendationVMs } from "@/lib/draft/recommendation-vm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Position } from "@/lib/supabase/types";
import type { PickWithDetails } from "@/lib/draft/data";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];

export default async function DraftAnalysisPage({ params }: PageProps<"/drafts/[id]/analysis">) {
  const { id } = await params;
  const bundle = await fetchDraftBundle(id);
  if (!bundle) notFound();
  if (bundle.draft.status === "setup") redirect(`/drafts/${id}/setup`);

  const state = computeDraftState(bundle);
  const availablePlayers = toAvailablePlayerVMs(state.availableRankings);

  const picksWithDelta = bundle.picks.filter((p) => p.adp_delta != null);
  const biggestReaches = [...picksWithDelta].sort((a, b) => (a.adp_delta ?? 0) - (b.adp_delta ?? 0)).slice(0, 5);
  const biggestSteals = [...picksWithDelta].sort((a, b) => (b.adp_delta ?? 0) - (a.adp_delta ?? 0)).slice(0, 5);

  const scarcity = computePositionScarcity(
    bundle.rankings.map((r) => ({ position: r.players.position, rankAdp: r.rank_adp })),
    bundle.picks.map((p) => p.players.position),
    state.currentPickNumber,
  );

  const recommendations = state.userTeam
    ? toRecommendationVMs(
        computeRecommendations({
          candidates: availablePlayers.map((p) => ({
            fpPlayerId: p.fpPlayerId,
            name: p.name,
            position: p.position,
            rankAdp: p.rankAdp,
            rankEcr: p.rankEcr,
          })),
          currentPickNumber: state.currentPickNumber,
          numTeams: bundle.draft.num_teams,
          userDraftPosition: state.userTeam.draft_position,
          rosterSlots: bundle.rosterSlots,
          userAssignedSlots: bundle.picks
            .filter((p) => p.team_id === state.userTeam!.id)
            .map((p) => p.assigned_slot_type),
          limit: 25,
        }),
        availablePlayers,
      )
    : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{bundle.draft.name} · Analysis</h1>
        <div className="flex items-center gap-3">
          <Link href={`/drafts/${id}`} className="text-sm text-slate-300 hover:text-slate-100">
            Draft room
          </Link>
          <Link href={`/drafts/${id}/board`} className="text-sm text-slate-300 hover:text-slate-100">
            Board
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Biggest reaches</CardTitle>
          </CardHeader>
          <CardContent>
            <PickList picks={biggestReaches} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Biggest steals</CardTitle>
          </CardHeader>
          <CardContent>
            <PickList picks={biggestSteals} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Position scarcity</CardTitle>
          </CardHeader>
          <CardContent>
            <ScarcityAlerts scarcity={scarcity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recommendations for you</CardTitle>
          </CardHeader>
          <CardContent>
            <RecommendationsPanel recommendations={recommendations} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Value remaining by position</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {POSITIONS.map((position) => {
                const top = availablePlayers
                  .filter((p) => p.position === position)
                  .sort((a, b) => (a.rankAdp ?? Infinity) - (b.rankAdp ?? Infinity))
                  .slice(0, 5);
                return (
                  <div key={position}>
                    <p className="mb-1 text-xs font-semibold text-slate-400">{position}</p>
                    <ul className="flex flex-col gap-0.5">
                      {top.map((p) => (
                        <li key={p.fpPlayerId} className="truncate text-xs text-slate-300">
                          {p.name}
                        </li>
                      ))}
                      {top.length === 0 && <li className="text-xs text-slate-600">None left</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PickList({ picks }: { picks: PickWithDetails[] }) {
  if (picks.length === 0) return <p className="text-sm text-slate-500">No graded picks yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-slate-800">
      {picks.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate text-slate-100">
              {p.players.name} <span className="text-xs text-slate-500">({p.players.position})</span>
            </p>
            <p className="text-xs text-slate-500">
              Pick {p.pick_number} · {p.draft_teams.name}
            </p>
          </div>
          <ValueLabelBadge adpDelta={p.adp_delta} />
        </li>
      ))}
    </ul>
  );
}
