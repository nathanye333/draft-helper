import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { fetchDraftBundle } from "@/lib/draft/data";
import { computeDraftState, toAvailablePlayerVMs, toPickFeedVMs, computeRosterForTeam } from "@/lib/draft/view";
import { computeRecommendations, toRecommendationVMs } from "@/lib/analytics/recommendations";
import { PlayerSearch } from "@/components/draft-room/player-search";
import { PickFeed } from "@/components/draft-room/pick-feed";
import { MyRoster } from "@/components/draft-room/my-roster";
import { RecommendationsPanel } from "@/components/draft-room/recommendations-panel";
import { UndoButton } from "@/components/draft-room/undo-button";
import { ClientIslandErrorBoundary } from "@/components/draft-room/client-island-error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DraftRoomPage({ params }: PageProps<"/drafts/[id]">) {
  const { id } = await params;
  const bundle = await fetchDraftBundle(id);
  if (!bundle) notFound();

  if (bundle.draft.status === "setup") redirect(`/drafts/${id}/setup`);

  const state = computeDraftState(bundle);
  const availablePlayers = toAvailablePlayerVMs(state.availableRankings);
  const pickFeed = toPickFeedVMs(bundle);

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

  const myRoster = state.userTeam ? computeRosterForTeam(bundle, state.userTeam.id) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            Pick {state.currentPickNumber} · Round {state.currentRound}
            {state.onClockTeam ? ` · ${state.onClockTeam.name} on the clock` : ""}
          </h1>
          <p className="text-sm text-slate-400">{bundle.draft.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/drafts/${id}/board`} className="text-sm text-slate-300 hover:text-slate-100">
            Board
          </Link>
          <Link href={`/drafts/${id}/analysis`} className="text-sm text-slate-300 hover:text-slate-100">
            Analysis
          </Link>
          <ClientIslandErrorBoundary name="Undo">
            <UndoButton draftId={id} disabled={bundle.picks.length === 0} />
          </ClientIslandErrorBoundary>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Player search</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientIslandErrorBoundary name="Player search">
              <PlayerSearch
                draftId={id}
                availablePlayers={availablePlayers}
                teams={bundle.teams}
                defaultTeamId={state.onClockTeam?.id ?? null}
              />
            </ClientIslandErrorBoundary>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent picks</CardTitle>
          </CardHeader>
          <CardContent>
            <ClientIslandErrorBoundary name="Recent picks">
              <PickFeed picks={pickFeed} />
            </ClientIslandErrorBoundary>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My roster</CardTitle>
          </CardHeader>
          <CardContent>
            {state.userTeam ? (
              <MyRoster teamName={state.userTeam.name} slots={myRoster} />
            ) : (
              <p className="text-sm text-slate-500">No team marked as yours.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <ClientIslandErrorBoundary name="Recommendations">
            <RecommendationsPanel recommendations={recommendations} />
          </ClientIslandErrorBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
