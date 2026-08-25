import { createAdminClient } from "@/lib/supabase/admin";
import { loadRosterScopeAdmin } from "@/lib/news/roster-scope-admin";
import { detectRedditSpikesForPlayers } from "@/lib/news/reddit-spikes";
import {
  claimAlertSend,
  getLeagueEmailPrefs,
  listDigestEnabledLeagues,
  listInstantEnabledLeagues,
  releaseAlertSend,
  resolveUserEmail,
} from "@/lib/news/email/prefs";
import { sendEmail } from "@/lib/news/email/resend";
import {
  formatDigestEmail,
  formatInjuryDeltaEmail,
  formatRedditSpikeEmail,
} from "@/lib/news/email/templates";
import { buildNewsFeedForPlayers } from "@/lib/news/aggregate";
import { buildInjuryBoard } from "@/lib/news/injury-board";
import { isStarterSlot } from "@/lib/league/slot-order";

const URGENT_INJURY = new Set(["OUT", "IR", "DOUBTFUL", "INJURY_RESERVE"]);

function withHttps(hostOrUrl: string): string {
  const s = hostOrUrl.trim();
  if (!s) return "http://localhost:3000";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function appBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    return withHttps(process.env.NEXT_PUBLIC_APP_URL);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    return withHttps(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  }
  if (process.env.VERCEL_URL?.trim()) {
    return withHttps(process.env.VERCEL_URL);
  }
  return "http://localhost:3000";
}

async function leagueName(leagueId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data } = await supabase.from("leagues").select("name").eq("id", leagueId).maybeSingle();
  return data?.name ? String(data.name) : "Your league";
}

export async function sendRedditSpikeAlertsForLeague(
  leagueId: string,
  userId: string,
): Promise<{ sent: number; skipped: number; error?: string }> {
  const prefs = await getLeagueEmailPrefs(leagueId);
  if (!prefs?.instantEnabled) return { sent: 0, skipped: 0 };

  const email = await resolveUserEmail(userId);
  if (!email) return { sent: 0, skipped: 0, error: "no email" };

  const scope = await loadRosterScopeAdmin(leagueId, userId);
  if (!scope || scope.players.length === 0) return { sent: 0, skipped: 0 };

  const spikes = await detectRedditSpikesForPlayers(scope.players);
  if (spikes.length === 0) return { sent: 0, skipped: 0 };

  const name = await leagueName(leagueId);
  let sent = 0;
  let skipped = 0;

  for (const post of spikes.slice(0, 5)) {
    const fingerprint = `reddit:${post.id}`;
    const { subject, text, html } = formatRedditSpikeEmail({
      leagueName: name,
      appUrl: appBaseUrl(),
      leagueId,
      posts: [post],
    });
    const claimed = await claimAlertSend({
      leagueId,
      userId,
      kind: "reddit_spike",
      fingerprint,
      subject,
    });
    if (!claimed) {
      skipped += 1;
      continue;
    }
    const result = await sendEmail({ to: email, subject, text, html });
    if (!result.ok) {
      await releaseAlertSend({ leagueId, kind: "reddit_spike", fingerprint });
      console.warn("[reddit spike email]", result.error);
      return { sent, skipped, error: result.error };
    }
    sent += 1;
  }

  return { sent, skipped };
}

export async function runInstantRedditSpikeScan(): Promise<{
  leagues: number;
  sent: number;
  errors: string[];
}> {
  const leagues = await listInstantEnabledLeagues();
  let sent = 0;
  const errors: string[] = [];
  for (const prefs of leagues) {
    try {
      const result = await sendRedditSpikeAlertsForLeague(prefs.leagueId, prefs.userId);
      sent += result.sent;
      if (result.error) errors.push(`${prefs.leagueId}: ${result.error}`);
    } catch (err) {
      errors.push(
        `${prefs.leagueId}: ${err instanceof Error ? err.message : "spike scan failed"}`,
      );
    }
  }
  return { leagues: leagues.length, sent, errors };
}

export async function maybeSendInjuryDeltaAlerts(params: {
  leagueId: string;
  deltas: Array<{
    espnPlayerId: number;
    playerName: string;
    fromStatus: string | null;
    toStatus: string;
  }>;
}): Promise<{ sent: number }> {
  if (params.deltas.length === 0) return { sent: 0 };

  const prefs = await getLeagueEmailPrefs(params.leagueId);
  if (!prefs?.instantEnabled) return { sent: 0 };

  const urgent = params.deltas.filter((d) => URGENT_INJURY.has(d.toStatus.toUpperCase()));
  if (urgent.length === 0) return { sent: 0 };

  const email = await resolveUserEmail(prefs.userId);
  if (!email) return { sent: 0 };

  const scope = await loadRosterScopeAdmin(params.leagueId, prefs.userId);
  const starterIds = new Set(
    (scope?.players ?? [])
      .filter((p) => p.scope === "roster" && p.isStarter)
      .map((p) => p.espnPlayerId),
  );

  const prioritized = urgent.filter((d) => starterIds.has(d.espnPlayerId));
  const toAlert = prioritized.length > 0 ? prioritized : urgent;

  const name = await leagueName(params.leagueId);
  const day = new Date().toISOString().slice(0, 10);
  let sent = 0;

  for (const d of toAlert) {
    const fingerprint = `injury:${d.espnPlayerId}:${d.toStatus.toUpperCase()}:${day}`;
    const { subject, text, html } = formatInjuryDeltaEmail({
      leagueName: name,
      appUrl: appBaseUrl(),
      leagueId: params.leagueId,
      deltas: [
        {
          playerName: d.playerName,
          fromStatus: d.fromStatus,
          toStatus: d.toStatus,
          isStarter: starterIds.has(d.espnPlayerId),
        },
      ],
    });
    const claimed = await claimAlertSend({
      leagueId: params.leagueId,
      userId: prefs.userId,
      kind: "injury_delta",
      fingerprint,
      subject,
    });
    if (!claimed) continue;
    const result = await sendEmail({ to: email, subject, text, html });
    if (result.ok) sent += 1;
    else {
      await releaseAlertSend({
        leagueId: params.leagueId,
        kind: "injury_delta",
        fingerprint,
      });
      console.warn("[injury email]", result.error);
    }
  }

  return { sent };
}

/**
 * Send daily digests for every league with digest enabled.
 * Vercel Hobby only allows one daily cron tick — filtering by digest_hour_utc
 * would silently skip anyone who picked a different hour in the UI.
 */
export async function runDailyDigestsForCurrentHour(now = new Date()): Promise<{
  hourUtc: number;
  leagues: number;
  sent: number;
  skipped: number;
  errors: string[];
}> {
  const hourUtc = now.getUTCHours();
  const leagues = await listDigestEnabledLeagues();
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const day = now.toISOString().slice(0, 10);

  for (const prefs of leagues) {
    try {
      const fingerprint = `digest:${day}`;
      const email = await resolveUserEmail(prefs.userId);
      if (!email) {
        errors.push(`${prefs.leagueId}: no email`);
        continue;
      }

      const name = await leagueName(prefs.leagueId);
      const scope = await loadRosterScopeAdmin(prefs.leagueId, prefs.userId);
      const feed = scope
        ? await buildNewsFeedForPlayers(scope.players, scope.playersById)
        : [];

      const items = feed
        .filter((i) => i.bucket === "needs_action" || i.bucket === "monitor" || i.score >= 4)
        .slice(0, 15);

      const injuryBoard = scope ? buildInjuryBoard(scope.players, scope.injuryDeltas) : [];
      const injuryLines = injuryBoard
        .filter((p) => p.delta)
        .slice(0, 10)
        .map(
          (p) =>
            `${p.name}: ${p.delta!.fromStatus ?? "—"} → ${p.delta!.toStatus}${
              isStarterSlot(p.lineupSlot) ? " (starter)" : ""
            }`,
        );

      const { subject, text, html } = formatDigestEmail({
        leagueName: name,
        appUrl: appBaseUrl(),
        leagueId: prefs.leagueId,
        items,
        injuryLines,
      });

      const claimed = await claimAlertSend({
        leagueId: prefs.leagueId,
        userId: prefs.userId,
        kind: "digest",
        fingerprint,
        subject,
      });
      if (!claimed) {
        skipped += 1;
        continue;
      }

      const result = await sendEmail({ to: email, subject, text, html });
      if (result.ok) sent += 1;
      else {
        await releaseAlertSend({
          leagueId: prefs.leagueId,
          kind: "digest",
          fingerprint,
        });
        errors.push(`${prefs.leagueId}: ${result.error}`);
      }
    } catch (err) {
      errors.push(
        `${prefs.leagueId}: ${err instanceof Error ? err.message : "digest failed"}`,
      );
    }
  }

  return { hourUtc, leagues: leagues.length, sent, skipped, errors };
}
