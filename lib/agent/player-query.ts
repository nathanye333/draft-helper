import type { DraftBundle } from "@/lib/draft/data";
import { computeDraftState, computeRosterForTeam } from "@/lib/draft/view";
import type { Position } from "@/lib/supabase/types";

export interface PlayerRow {
  fpPlayerId: string;
  name: string;
  position: Position;
  nflTeam: string | null;
  byeWeek: number | null;
  rankAdp: number | null;
  rankEcr: number | null;
  tier: number | null;
  available: boolean;
  draftedBy: string | null;
  pickNumber: number | null;
}

export type PlayerOrderBy = "adp" | "ecr" | "name" | "tier";

export interface QueryPlayersParams {
  nameContains?: string;
  position?: Position;
  availableOnly?: boolean;
  adpMin?: number;
  adpMax?: number;
  ecrMin?: number;
  ecrMax?: number;
  tier?: number;
  nflTeam?: string;
  limit?: number;
  orderBy?: PlayerOrderBy;
}

export type AggregateGroupBy = "position" | "tier" | "nflTeam";

export interface AggregatePlayersParams {
  groupBy: AggregateGroupBy;
  availableOnly?: boolean;
}

export interface AggregateBucket {
  key: string;
  count: number;
  adpMin: number | null;
  adpAvg: number | null;
  adpMax: number | null;
}

/** Flatten rankings + picks into analysis-friendly player rows for one draft. */
export function buildPlayerRows(bundle: DraftBundle): PlayerRow[] {
  const pickByPlayer = new Map(
    bundle.picks.map((p) => [
      p.fp_player_id,
      { teamName: p.draft_teams.name, pickNumber: p.pick_number },
    ]),
  );

  return bundle.rankings.map((r) => {
    const pick = pickByPlayer.get(r.fp_player_id);
    return {
      fpPlayerId: r.fp_player_id,
      name: r.players.name,
      position: r.players.position,
      nflTeam: r.players.nfl_team,
      byeWeek: r.players.bye_week,
      rankAdp: r.rank_adp,
      rankEcr: r.rank_ecr,
      tier: r.tier,
      available: !pick,
      draftedBy: pick?.teamName ?? null,
      pickNumber: pick?.pickNumber ?? null,
    };
  });
}

function compareNullable(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export function queryPlayers(rows: PlayerRow[], params: QueryPlayersParams): PlayerRow[] {
  const {
    nameContains,
    position,
    availableOnly,
    adpMin,
    adpMax,
    ecrMin,
    ecrMax,
    tier,
    nflTeam,
    limit = 25,
    orderBy = "adp",
  } = params;

  const needle = nameContains?.trim().toLowerCase();
  const teamNeedle = nflTeam?.trim().toLowerCase();

  let filtered = rows.filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    if (position && row.position !== position) return false;
    if (availableOnly && !row.available) return false;
    if (adpMin != null && (row.rankAdp == null || row.rankAdp < adpMin)) return false;
    if (adpMax != null && (row.rankAdp == null || row.rankAdp > adpMax)) return false;
    if (ecrMin != null && (row.rankEcr == null || row.rankEcr < ecrMin)) return false;
    if (ecrMax != null && (row.rankEcr == null || row.rankEcr > ecrMax)) return false;
    if (tier != null && row.tier !== tier) return false;
    if (teamNeedle && (row.nflTeam == null || !row.nflTeam.toLowerCase().includes(teamNeedle))) {
      return false;
    }
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    switch (orderBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "ecr":
        return compareNullable(a.rankEcr, b.rankEcr);
      case "tier":
        return compareNullable(a.tier, b.tier) || compareNullable(a.rankAdp, b.rankAdp);
      case "adp":
      default:
        return compareNullable(a.rankAdp, b.rankAdp);
    }
  });

  const capped = Math.min(Math.max(limit, 1), 100);
  return filtered.slice(0, capped);
}

export function aggregatePlayers(
  rows: PlayerRow[],
  params: AggregatePlayersParams,
): AggregateBucket[] {
  const scoped = params.availableOnly ? rows.filter((r) => r.available) : rows;
  const buckets = new Map<string, { count: number; adps: number[] }>();

  for (const row of scoped) {
    let key: string;
    if (params.groupBy === "position") key = row.position;
    else if (params.groupBy === "tier") key = row.tier != null ? String(row.tier) : "unranked";
    else key = row.nflTeam ?? "FA";

    const bucket = buckets.get(key) ?? { count: 0, adps: [] };
    bucket.count += 1;
    if (row.rankAdp != null) bucket.adps.push(row.rankAdp);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, { count, adps }]) => {
      const adpMin = adps.length ? Math.min(...adps) : null;
      const adpMax = adps.length ? Math.max(...adps) : null;
      const adpAvg = adps.length ? adps.reduce((s, n) => s + n, 0) / adps.length : null;
      return {
        key,
        count,
        adpMin,
        adpAvg: adpAvg != null ? Math.round(adpAvg * 10) / 10 : null,
        adpMax,
      };
    })
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function findPlayersByNameOrId(
  rows: PlayerRow[],
  query: string,
  limit = 10,
): PlayerRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const exactId = rows.filter((r) => r.fpPlayerId === query.trim());
  if (exactId.length) return exactId.slice(0, limit);

  const exactName = rows.filter((r) => r.name.toLowerCase() === needle);
  if (exactName.length) return exactName.slice(0, limit);

  return rows
    .filter((r) => r.name.toLowerCase().includes(needle))
    .sort((a, b) => compareNullable(a.rankAdp, b.rankAdp))
    .slice(0, limit);
}

export function getDraftSnapshot(bundle: DraftBundle) {
  const state = computeDraftState(bundle);
  const userRoster = state.userTeam ? computeRosterForTeam(bundle, state.userTeam.id) : null;
  const emptySlots =
    userRoster?.flatMap((slot) =>
      slot.playerNames
        .map((name, i) => ({ slotType: slot.slotType, index: i + 1, filled: name != null, playerName: name }))
        .filter((s) => !s.filled)
        .map((s) => `${s.slotType}${slot.playerNames.length > 1 ? ` #${s.index}` : ""}`),
    ) ?? [];

  return {
    draftName: bundle.draft.name,
    season: bundle.draft.season,
    scoring: bundle.draft.scoring,
    status: bundle.draft.status,
    numTeams: bundle.draft.num_teams,
    currentPickNumber: state.currentPickNumber,
    currentRound: state.currentRound,
    onClockTeam: state.onClockTeam
      ? { name: state.onClockTeam.name, draftPosition: state.onClockTeam.draft_position }
      : null,
    userTeam: state.userTeam
      ? { name: state.userTeam.name, draftPosition: state.userTeam.draft_position }
      : null,
    picksMade: bundle.picks.length,
    availablePlayers: state.availableRankings.length,
    emptyStarterOrBenchSlots: emptySlots,
  };
}
