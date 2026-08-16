import { createClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import {
  EspnApiError,
  fetchEspnLeagueSnapshot,
  type EspnCookies,
} from "@/lib/espn/client";
import { resolveEspnToFpIds } from "@/lib/espn/id-map";
import { syncProjectionsForSeason } from "@/lib/fantasypros/projections-sync";
import type { ScoringFormat } from "@/lib/supabase/types";

export type SyncLeagueResult =
  | { ok: true; leagueId: string; teamCount: number; rosterCount: number; syncedAt: string }
  | { ok: false; reason: "not_found" | "auth" | "api_error"; message: string };

export interface ConnectEspnInput {
  espnLeagueId: string;
  season: number;
  swid: string;
  espnS2: string;
  myEspnTeamId: number;
  name?: string;
}

export async function connectEspnLeague(input: ConnectEspnInput): Promise<SyncLeagueResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { ok: false, reason: "auth", message: "Not authenticated" };
  }

  const cookies: EspnCookies = { swid: input.swid, espnS2: input.espnS2 };

  let snapshot;
  try {
    snapshot = await fetchEspnLeagueSnapshot({
      leagueId: input.espnLeagueId,
      season: input.season,
      cookies,
    });
  } catch (err) {
    const message = err instanceof EspnApiError ? err.message : "Failed to reach ESPN";
    return { ok: false, reason: "api_error", message };
  }

  if (!snapshot.teams.some((t) => t.espnTeamId === input.myEspnTeamId)) {
    return {
      ok: false,
      reason: "api_error",
      message: "Selected team was not found in this ESPN league.",
    };
  }

  const name = input.name?.trim() || snapshot.name;
  const scoring = snapshot.scoring as ScoringFormat;

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .upsert(
      {
        user_id: userData.user.id,
        name,
        season: input.season,
        source: "espn",
        scoring,
        espn_league_id: String(input.espnLeagueId),
        my_espn_team_id: input.myEspnTeamId,
        current_week: snapshot.currentWeek,
        settings: {
          name: snapshot.name,
          rosterSlots: snapshot.rosterSlots,
        },
      },
      { onConflict: "user_id,espn_league_id,season" },
    )
    .select()
    .single();

  if (leagueError || !league) {
    return {
      ok: false,
      reason: "api_error",
      message: leagueError?.message ?? "Failed to save league",
    };
  }

  const { error: credError } = await supabase.from("league_espn_credentials").upsert({
    league_id: league.id,
    swid_ciphertext: encryptSecret(input.swid.trim()),
    espn_s2_ciphertext: encryptSecret(input.espnS2.trim()),
  });

  if (credError) {
    return { ok: false, reason: "api_error", message: credError.message };
  }

  return persistSnapshot(league.id, snapshot, input.myEspnTeamId, scoring);
}

export async function syncEspnLeague(leagueId: string): Promise<SyncLeagueResult> {
  const supabase = await createClient();
  const { data: league, error } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();

  if (error || !league) {
    return { ok: false, reason: "not_found", message: "League not found" };
  }

  const { data: creds } = await supabase
    .from("league_espn_credentials")
    .select("swid_ciphertext, espn_s2_ciphertext")
    .eq("league_id", leagueId)
    .single();

  if (!creds) {
    return { ok: false, reason: "auth", message: "ESPN credentials missing — reconnect." };
  }

  let cookies: EspnCookies;
  try {
    cookies = {
      swid: decryptSecret(creds.swid_ciphertext),
      espnS2: decryptSecret(creds.espn_s2_ciphertext),
    };
  } catch {
    return { ok: false, reason: "auth", message: "Could not decrypt ESPN cookies — reconnect." };
  }

  let snapshot;
  try {
    snapshot = await fetchEspnLeagueSnapshot({
      leagueId: String(league.espn_league_id),
      season: league.season,
      cookies,
    });
  } catch (err) {
    const message =
      err instanceof EspnApiError
        ? err.status === 401 || err.status === 403
          ? "ESPN rejected credentials — paste fresh SWID / espn_s2 cookies."
          : err.message
        : "Failed to reach ESPN";
    return { ok: false, reason: "api_error", message };
  }

  await supabase
    .from("leagues")
    .update({
      name: league.name || snapshot.name,
      scoring: snapshot.scoring,
      current_week: snapshot.currentWeek,
      settings: {
        ...(typeof league.settings === "object" && league.settings ? league.settings : {}),
        name: snapshot.name,
        rosterSlots: snapshot.rosterSlots,
      },
    })
    .eq("id", leagueId);

  return persistSnapshot(
    leagueId,
    snapshot,
    league.my_espn_team_id as number | null,
    snapshot.scoring,
  );
}

async function persistSnapshot(
  leagueId: string,
  snapshot: Awaited<ReturnType<typeof fetchEspnLeagueSnapshot>>,
  myEspnTeamId: number | null,
  scoring: ScoringFormat,
): Promise<SyncLeagueResult> {
  const supabase = await createClient();
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
    return { ok: false, reason: "api_error", message: teamsError.message };
  }

  const fpMap = await resolveEspnToFpIds(
    snapshot.rosterEntries.map((e) => ({
      espnPlayerId: e.espnPlayerId,
      playerName: e.playerName,
      nflTeam: e.nflTeam,
    })),
  );

  const rosterRows = snapshot.rosterEntries.map((e) => ({
    league_id: leagueId,
    espn_team_id: e.espnTeamId,
    espn_player_id: e.espnPlayerId,
    player_name: e.playerName,
    position: e.position,
    nfl_team: e.nflTeam,
    lineup_slot: e.lineupSlot,
    injury_status: e.injuryStatus,
    fp_player_id: fpMap.get(e.espnPlayerId) ?? null,
  }));

  // Replace roster snapshot for this league.
  await supabase.from("league_roster_entries").delete().eq("league_id", leagueId);
  if (rosterRows.length > 0) {
    const { error: rosterError } = await supabase.from("league_roster_entries").insert(rosterRows);
    if (rosterError) {
      return { ok: false, reason: "api_error", message: rosterError.message };
    }
  }

  await supabase.from("league_matchups").delete().eq("league_id", leagueId);
  if (snapshot.matchups.length > 0) {
    const { error: matchupError } = await supabase.from("league_matchups").insert(
      snapshot.matchups.map((m) => ({
        league_id: leagueId,
        week: m.week,
        home_espn_team_id: m.homeEspnTeamId,
        away_espn_team_id: m.awayEspnTeamId,
        home_points: m.homePoints,
        away_points: m.awayPoints,
      })),
    );
    if (matchupError) {
      return { ok: false, reason: "api_error", message: matchupError.message };
    }
  }

  await supabase.from("leagues").update({ last_synced_at: syncedAt }).eq("id", leagueId);

  // Best-effort FP projections refresh (admin writes).
  try {
    const week = snapshot.currentWeek && snapshot.currentWeek > 0 ? snapshot.currentWeek : 0;
    await syncProjectionsForSeason({
      season: snapshot.season,
      scoring,
      weeks: week > 0 ? [0, week] : [0],
    });
  } catch (err) {
    console.warn(
      "FP projection sync after ESPN sync failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    ok: true,
    leagueId,
    teamCount: teamRows.length,
    rosterCount: rosterRows.length,
    syncedAt,
  };
}

/** Update stored cookies without a full reconnect. */
export async function updateEspnCredentials(
  leagueId: string,
  cookies: { swid: string; espnS2: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createClient();
  const { data: league } = await supabase.from("leagues").select("id").eq("id", leagueId).single();
  if (!league) return { ok: false, message: "League not found" };

  const { error } = await supabase.from("league_espn_credentials").upsert({
    league_id: leagueId,
    swid_ciphertext: encryptSecret(cookies.swid.trim()),
    espn_s2_ciphertext: encryptSecret(cookies.espnS2.trim()),
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
