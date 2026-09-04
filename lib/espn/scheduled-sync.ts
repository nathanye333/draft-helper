/**
 * Cookie-free ESPN sync for cron / service-role jobs.
 * Updates rosters + injury deltas (and emails) without a user session.
 * Skips heavy player-universe / FP projection sync to stay under cron time limits.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto/secrets";
import {
  EspnApiError,
  fetchEspnLeagueSnapshot,
  type EspnCookies,
} from "@/lib/espn/client";

export type ScheduledSyncResult =
  | {
      ok: true;
      leagueId: string;
      rosterCount: number;
      injuryDeltas: number;
      injuryEmailsSent: number;
      syncedAt: string;
    }
  | { ok: false; leagueId: string; reason: string; message: string };

async function syncLeagueAdmin(leagueId: string): Promise<ScheduledSyncResult> {
  const supabase = createAdminClient();

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, espn_league_id, season, my_espn_team_id, name, settings")
    .eq("id", leagueId)
    .maybeSingle();

  if (leagueError || !league?.espn_league_id) {
    return {
      ok: false,
      leagueId,
      reason: "not_found",
      message: leagueError?.message ?? "League not found",
    };
  }

  const { data: creds } = await supabase
    .from("league_espn_credentials")
    .select("swid_ciphertext, espn_s2_ciphertext")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (!creds) {
    return {
      ok: false,
      leagueId,
      reason: "auth",
      message: "ESPN credentials missing",
    };
  }

  let cookies: EspnCookies;
  try {
    cookies = {
      swid: decryptSecret(String(creds.swid_ciphertext)),
      espnS2: decryptSecret(String(creds.espn_s2_ciphertext)),
    };
  } catch {
    return {
      ok: false,
      leagueId,
      reason: "auth",
      message: "Could not decrypt ESPN cookies",
    };
  }

  let snapshot: Awaited<ReturnType<typeof fetchEspnLeagueSnapshot>>;
  try {
    snapshot = await fetchEspnLeagueSnapshot({
      leagueId: String(league.espn_league_id),
      season: Number(league.season),
      cookies,
    });
  } catch (err) {
    const message =
      err instanceof EspnApiError
        ? err.status === 401 || err.status === 403
          ? "ESPN rejected credentials"
          : err.message
        : "Failed to reach ESPN";
    return { ok: false, leagueId, reason: "api_error", message };
  }

  const myEspnTeamId =
    league.my_espn_team_id != null ? Number(league.my_espn_team_id) : null;
  const syncedAt = new Date().toISOString();

  const teamRows = snapshot.teams.map((t) => ({
    league_id: leagueId,
    espn_team_id: t.espnTeamId,
    name: t.name,
    abbrev: t.abbrev,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    points_for: t.pointsFor,
    points_against: t.pointsAgainst,
    playoff_seed: t.playoffSeed,
    is_user_team: myEspnTeamId != null && t.espnTeamId === myEspnTeamId,
  }));

  const { error: teamsError } = await supabase
    .from("league_teams")
    .upsert(teamRows, { onConflict: "league_id,espn_team_id" });
  if (teamsError) {
    return { ok: false, leagueId, reason: "api_error", message: teamsError.message };
  }

  const rosterRows = snapshot.rosterEntries.map((e) => ({
    league_id: leagueId,
    espn_team_id: e.espnTeamId,
    espn_player_id: e.espnPlayerId,
    player_name: e.playerName,
    position: e.position,
    nfl_team: e.nflTeam,
    lineup_slot: e.lineupSlot,
    injury_status: e.injuryStatus,
  }));

  const { data: previousRoster } = await supabase
    .from("league_roster_entries")
    .select("espn_player_id, player_name, injury_status")
    .eq("league_id", leagueId);

  await supabase.from("league_roster_entries").delete().eq("league_id", leagueId);
  if (rosterRows.length > 0) {
    const { error: rosterError } = await supabase
      .from("league_roster_entries")
      .insert(rosterRows);
    if (rosterError) {
      return { ok: false, leagueId, reason: "api_error", message: rosterError.message };
    }
  }

  let injuryDeltas = 0;
  let injuryEmailsSent = 0;
  try {
    const { recordInjuryDeltasAdmin } = await import("@/lib/news/injury-deltas");
    const { invalidateNewsCache } = await import("@/lib/news/cache");
    const deltas = await recordInjuryDeltasAdmin(
      leagueId,
      previousRoster ?? [],
      rosterRows,
    );
    injuryDeltas = deltas.length;
    invalidateNewsCache(leagueId);
    if (deltas.length > 0) {
      const { maybeSendInjuryDeltaAlerts } = await import("@/lib/news/alerts");
      const sent = await maybeSendInjuryDeltaAlerts({ leagueId, deltas });
      injuryEmailsSent = sent.sent;
    }
  } catch (err) {
    console.warn(
      "[scheduled ESPN sync] injury deltas:",
      err instanceof Error ? err.message : err,
    );
  }

  await supabase.from("league_matchups").delete().eq("league_id", leagueId);
  if (snapshot.matchups.length > 0) {
    await supabase.from("league_matchups").insert(
      snapshot.matchups.map((m) => ({
        league_id: leagueId,
        week: m.week,
        home_espn_team_id: m.homeEspnTeamId,
        away_espn_team_id: m.awayEspnTeamId,
        home_points: m.homePoints,
        away_points: m.awayPoints,
      })),
    );
  }

  await supabase
    .from("leagues")
    .update({
      current_week: snapshot.currentWeek,
      last_synced_at: syncedAt,
      settings: {
        ...(typeof league.settings === "object" && league.settings
          ? (league.settings as Record<string, unknown>)
          : {}),
        name: snapshot.name,
        rosterSlots: snapshot.rosterSlots,
      },
    })
    .eq("id", leagueId);

  return {
    ok: true,
    leagueId,
    rosterCount: rosterRows.length,
    injuryDeltas,
    injuryEmailsSent,
    syncedAt,
  };
}

/** Sync every league that has stored ESPN credentials. */
export async function runScheduledEspnRefresh(): Promise<{
  leagues: number;
  synced: number;
  failed: number;
  injuryDeltas: number;
  injuryEmailsSent: number;
  errors: string[];
  results: ScheduledSyncResult[];
}> {
  const supabase = createAdminClient();
  const { data: credRows, error } = await supabase
    .from("league_espn_credentials")
    .select("league_id");

  if (error) {
    return {
      leagues: 0,
      synced: 0,
      failed: 0,
      injuryDeltas: 0,
      injuryEmailsSent: 0,
      errors: [error.message],
      results: [],
    };
  }

  const leagueIds = [...new Set((credRows ?? []).map((r) => String(r.league_id)))];
  const results: ScheduledSyncResult[] = [];
  let synced = 0;
  let failed = 0;
  let injuryDeltas = 0;
  let injuryEmailsSent = 0;
  const errors: string[] = [];

  for (const leagueId of leagueIds) {
    try {
      const result = await syncLeagueAdmin(leagueId);
      results.push(result);
      if (result.ok) {
        synced += 1;
        injuryDeltas += result.injuryDeltas;
        injuryEmailsSent += result.injuryEmailsSent;
      } else {
        failed += 1;
        errors.push(`${leagueId}: ${result.message}`);
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : "sync failed";
      errors.push(`${leagueId}: ${message}`);
      results.push({ ok: false, leagueId, reason: "exception", message });
    }
  }

  return {
    leagues: leagueIds.length,
    synced,
    failed,
    injuryDeltas,
    injuryEmailsSent,
    errors,
    results,
  };
}
