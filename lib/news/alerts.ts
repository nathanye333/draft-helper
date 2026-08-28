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
import { urlHash } from "@/lib/news/dedupe";
import { fetchArticleBody, sanitizeArticleText } from "@/lib/news/article-body";
import {
  indexBodyChunks,
  keywordExcerptFallback,
  semanticExcerptsByUrlHash,
} from "@/lib/news/body-chunks";
import type { NewsItemView } from "@/lib/news/types";

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

/** Load stored article bodies by url_hash; fetch a few missing ones for digest quality. */
async function resolveBodiesForDigest(
  items: NewsItemView[],
): Promise<Map<string, string>> {
  const bodies = new Map<string, string>();
  if (items.length === 0) return bodies;

  const hashes = items.map((i) => urlHash(i.url));
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("news_items")
    .select("url_hash, body, snippet")
    .in("url_hash", hashes);

  const byHash = new Map(
    (data ?? []).map((row) => [
      String(row.url_hash),
      {
        body: typeof row.body === "string" ? row.body : null,
        snippet: typeof row.snippet === "string" ? row.snippet : null,
      },
    ]),
  );

  const missing: NewsItemView[] = [];
  for (const item of items) {
    const hash = urlHash(item.url);
    const stored = byHash.get(hash);
    const storedBody = sanitizeArticleText(stored?.body);
    if (storedBody) {
      bodies.set(hash, storedBody);
      continue;
    }
    const fallback = sanitizeArticleText(stored?.snippet) || sanitizeArticleText(item.snippet) || "";
    if (fallback) bodies.set(hash, fallback);
    missing.push(item);
  }

  // Best-effort fetch for items still thin (cap to keep cron under maxDuration).
  for (const item of missing.slice(0, 8)) {
    const hash = urlHash(item.url);
    if ((bodies.get(hash)?.length ?? 0) >= 200) continue;
    const fetched = sanitizeArticleText(await fetchArticleBody(item.url));
    if (!fetched) continue;
    bodies.set(hash, fetched);
    const { data: updated } = await supabase
      .from("news_items")
      .update({ body: fetched })
      .eq("url_hash", hash)
      .select("id")
      .maybeSingle();
    if (updated?.id) {
      void indexBodyChunks(supabase, {
        newsItemId: String(updated.id),
        title: item.title,
        body: fetched,
        playerNames: item.matchedPlayers.map((p) => p.name),
      });
    }
  }

  return bodies;
}

async function withExcerpts(
  items: NewsItemView[],
  bodies: Map<string, string>,
): Promise<Array<NewsItemView & { excerpt: string }>> {
  const semantic = await semanticExcerptsByUrlHash(items, {
    maxChunksPerItem: 2,
    maxChars: 360,
  });

  return items.map((item) => {
    const hash = urlHash(item.url);
    const excerpt =
      semantic.get(hash) ||
      keywordExcerptFallback(
        bodies.get(hash) || item.snippet || "",
        item.matchedPlayers.map((p) => p.name),
        360,
      );
    return { ...item, excerpt };
  });
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
    const claim = await claimAlertSend({
      leagueId,
      userId,
      kind: "reddit_spike",
      fingerprint,
      subject,
    });
    if (claim === "duplicate") {
      skipped += 1;
      continue;
    }
    if (claim !== "claimed") {
      console.warn("[reddit spike email]", claim.error);
      return { sent, skipped, error: claim.error };
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
    const claim = await claimAlertSend({
      leagueId: params.leagueId,
      userId: prefs.userId,
      kind: "injury_delta",
      fingerprint,
      subject,
    });
    if (claim !== "claimed") continue;
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
 * Send a news digest email for one league.
 * Cron uses daily fingerprint dedupe; manual sends use force to bypass it.
 */
export async function sendDigestForLeague(params: {
  leagueId: string;
  userId: string;
  now?: Date;
  force?: boolean;
}): Promise<{ sent: true } | { sent: false; skipped: true } | { sent: false; error: string }> {
  const now = params.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const fingerprint = params.force
    ? `digest:manual:${day}:${now.getTime()}`
    : `digest:${day}`;

  const email = await resolveUserEmail(params.userId);
  if (!email) return { sent: false, error: "no email" };

  const name = await leagueName(params.leagueId);
  const scope = await loadRosterScopeAdmin(params.leagueId, params.userId);
  const feed = scope
    ? await buildNewsFeedForPlayers(scope.players, scope.playersById)
    : [];

  const items = feed
    .filter((i) => i.bucket === "needs_action" || i.bucket === "monitor" || i.score >= 4)
    .slice(0, 15);

  const bodies = await resolveBodiesForDigest(items);
  const itemsWithExcerpts = await withExcerpts(items, bodies);

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
    leagueId: params.leagueId,
    items: itemsWithExcerpts,
    injuryLines,
  });

  const claim = await claimAlertSend({
    leagueId: params.leagueId,
    userId: params.userId,
    kind: "digest",
    fingerprint,
    subject,
  });
  if (claim === "duplicate") return { sent: false, skipped: true };
  if (claim !== "claimed") return { sent: false, error: claim.error };

  const result = await sendEmail({ to: email, subject, text, html });
  if (result.ok) return { sent: true };

  await releaseAlertSend({
    leagueId: params.leagueId,
    kind: "digest",
    fingerprint,
  });
  return { sent: false, error: result.error };
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

  for (const prefs of leagues) {
    try {
      const result = await sendDigestForLeague({
        leagueId: prefs.leagueId,
        userId: prefs.userId,
        now,
      });
      if (result.sent) sent += 1;
      else if ("skipped" in result && result.skipped) skipped += 1;
      else if ("error" in result && result.error) {
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
