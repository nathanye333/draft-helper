import { tool } from "langchain";
import { z } from "zod";
import { computeRecommendations } from "@/lib/analytics/recommendations";
import { computePositionScarcity } from "@/lib/analytics/scarcity";
import { createPlayerBoardTools } from "@/lib/agent/player-board-tools";
import { fetchDraftBundle, type DraftBundle } from "@/lib/draft/data";
import { computeDraftState, toAvailablePlayerVMs } from "@/lib/draft/view";
import {
  analyzeTeamRoster,
  buildPlayerRows,
  getDraftSnapshot,
  type PlayerRow,
} from "@/lib/agent/player-query";
import { webSearch } from "@/lib/agent/web-search";

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

async function loadContext(draftId: string): Promise<{
  bundle: DraftBundle;
  rows: PlayerRow[];
}> {
  const bundle = await fetchDraftBundle(draftId, { includeProjStats: true });
  if (!bundle) {
    throw new Error("Draft not found or you do not have access.");
  }
  return { bundle, rows: buildPlayerRows(bundle) };
}

/**
 * Read-only LangChain tools scoped to one draft. Bundle is loaded per tool
 * call via RLS-backed fetchDraftBundle (no admin client).
 */
export function createDraftTools(draftId: string) {
  const boardTools = createPlayerBoardTools({
    loadRows: async () => (await loadContext(draftId)).rows,
    availabilityNote: "available = still undrafted on this board",
  });

  const get_draft_snapshot = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      return json(getDraftSnapshot(bundle));
    },
    {
      name: "get_draft_snapshot",
      description:
        "Return the current draft state: pick number, round, on-clock team, scoring, roster needs, projection coverage, sortable columns.",
      schema: z.object({}),
    },
  );

  const analyze_roster = tool(
    async (input) => {
      const { bundle } = await loadContext(draftId);
      let teamId = input.teamId;
      if (!teamId && input.teamName) {
        const needle = input.teamName.trim().toLowerCase();
        teamId = bundle.teams.find((t) => t.name.toLowerCase().includes(needle))?.id;
      }
      if (!teamId) {
        const user = bundle.teams.find((t) => t.id === bundle.draft.my_team_id) ?? bundle.teams.find((t) => t.is_user_team);
        teamId = user?.id;
      }
      if (!teamId) return json({ error: "No team specified and no user team marked." });
      return json(analyzeTeamRoster(bundle, teamId));
    },
    {
      name: "analyze_roster",
      description:
        "Analyze a team's drafted roster: position counts, projected points sum, bye-week clusters. Defaults to your team.",
      schema: z.object({
        teamId: z.string().uuid().optional(),
        teamName: z.string().optional(),
      }),
    },
  );

  const get_recommendations = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      const state = computeDraftState(bundle);
      if (!state.userTeam) {
        return json({ error: "No team is marked as yours for this draft." });
      }
      const availablePlayers = toAvailablePlayerVMs(state.availableRankings);
      const recommendations = computeRecommendations({
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
        limit: 10,
      });
      return json({ recommendations });
    },
    {
      name: "get_recommendations",
      description:
        "Return the app's scored pick recommendations for the user's team at the current pick (value + need + scarcity).",
      schema: z.object({}),
    },
  );

  const get_position_scarcity = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      const state = computeDraftState(bundle);
      const scarcity = computePositionScarcity(
        bundle.rankings.map((r) => ({
          position: r.players.position,
          rankAdp: r.rank_adp,
        })),
        bundle.picks.map((p) => p.players.position),
        state.currentPickNumber,
      );
      return json({ scarcity });
    },
    {
      name: "get_position_scarcity",
      description:
        "Compare drafted counts vs ADP-expected counts per position (run / normal / falling).",
      schema: z.object({}),
    },
  );

  const list_teams = tool(
    async () => {
      const { bundle } = await loadContext(draftId);
      return json({
        teams: bundle.teams.map((t) => ({
          id: t.id,
          name: t.name,
          draftPosition: t.draft_position,
          isUserTeam: t.is_user_team || t.id === bundle.draft.my_team_id,
        })),
      });
    },
    {
      name: "list_teams",
      description: "List draft teams with positions and which one is the user's.",
      schema: z.object({}),
    },
  );

  const web_search = tool(
    async (input) => {
      const result = await webSearch(input.query, {
        maxResults: input.maxResults ?? 5,
      });
      // Compact JSON — pretty tool payloads bloat the follow-up model turn.
      return JSON.stringify({
        query: result.query,
        provider: result.provider,
        note: result.note,
        results: result.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet.slice(0, 240),
        })),
      });
    },
    {
      name: "web_search",
      description:
        "Search recent news/injuries/context (news RSS or Brave if configured). Use one short plain query (no stacked quotes). Prefer draft DB tools for ADP/ECR/projections.",
      schema: z.object({
        query: z
          .string()
          .describe("Short plain search query, e.g. 'NFL injury Nabers'"),
        maxResults: z.number().int().min(1).max(8).optional().default(5),
      }),
    },
  );

  return [
    ...boardTools,
    get_draft_snapshot,
    analyze_roster,
    list_teams,
    get_recommendations,
    get_position_scarcity,
    web_search,
  ];
}
