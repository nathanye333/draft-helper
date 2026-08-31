import { createAdminClient } from "@/lib/supabase/admin";
import { loadRosterScopeAdmin } from "@/lib/news/roster-scope-admin";
import { detectRedditSpikesForPlayers } from "@/lib/news/reddit-spikes";
import {
  claimAlertSend,
  getLeagueEmailPrefs,
  hasAlertSend,
  listDigestEnabledLeagues,
  listInstantEnabledLeagues,
  recordAlertSend,
  releaseAlertSend,
  resolveUserEmail,
} from "@/lib/news/email/prefs";
import { invalidateNewsCache } from "@/lib/news/cache";
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
import {
  DIGEST_EXCERPT_MAX_CHARS,
  EXCERPT_CHUNKS_PER_ITEM,
} from "@/lib/news/excerpt-limits";
import { DIGEST_LOOKBACK_HOURS, filterToDigestWindow } from "@/lib/news/digest-window";
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

/** Wall-clock budget for optional digest enrichment, well under the cron maxDuration. */
const ENRICHMENT_BUDGET_MS = 45_000;

/** Below this, a stored body cannot fill the excerpt budget — re-fetch the article. */
const THIN_BODY_CHARS = DIGEST_EXCERPT_MAX_CHARS * 2;

/** Article fetches per digest; the deadline above is the real safety net. */
const MAX_BODY_FETCHES = 14;

/** Load stored article bodies by url_hash; fetch a few missing ones for digest quality. */
async function resolveBodiesForDigest(
  items: NewsItemView[],
  deadline = Number.POSITIVE_INFINITY,
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
      // A stored body shorter than the excerpt budget still leaves the digest
      // thin, so queue it for a full re-fetch.
      if (storedBody.length >= THIN_BODY_CHARS) continue;
    } else {
      const fallback =
        sanitizeArticleText(stored?.snippet) || sanitizeArticleText(item.snippet) || "";
      if (fallback) bodies.set(hash, fallback);
    }
    missing.push(item);
  }

  // Best-effort fetch for items still thin (cap to keep cron under maxDuration).
  for (const item of missing.slice(0, MAX_BODY_FETCHES)) {
    if (Date.now() > deadline) break;
    const hash = urlHash(item.url);
    if ((bodies.get(hash)?.length ?? 0) >= THIN_BODY_CHARS) continue;
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
  let semantic = new Map<string, string>();
  try {
    semantic = await semanticExcerptsByUrlHash(items, {
      maxChunksPerItem: EXCERPT_CHUNKS_PER_ITEM,
      maxChars: DIGEST_EXCERPT_MAX_CHARS,
    });
  } catch (err) {
    console.warn("[digest excerpts]", err instanceof Error ? err.message : err);
  }

  return items.map((item) => {
    const hash = urlHash(item.url);
    const excerpt =
      semantic.get(hash) ||
      keywordExcerptFallback(
        bodies.get(hash) || item.snippet || "",
        item.matchedPlayers.map((p) => p.name),
        DIGEST_EXCERPT_MAX_CHARS,
      );
    return { ...item, excerpt };
  });
}

/**
 * Article bodies and semantic excerpts only improve digest wording, so a failure
 * here must never stop the email — fall back to snippet-based excerpts.
 */
async function buildDigestExcerpts(
  items: NewsItemView[],
): Promise<Array<NewsItemView & { excerpt: string }>> {
  const deadline = Date.now() + ENRICHMENT_BUDGET_MS;
  try {
    const bodies = await resolveBodiesForDigest(items, deadline);
    return await withExcerpts(items, bodies);
  } catch (err) {
    console.warn("[digest enrichment]", err instanceof Error ? err.message : err);
    return items.map((item) => ({
      ...item,
      excerpt: keywordExcerptFallback(
        item.snippet || "",
        item.matchedPlayers.map((p) => p.name),
        DIGEST_EXCERPT_MAX_CHARS,
      ),
    }));
  }
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

export type DigestSkipReason = "already_sent" | "no_recent_news";

export type DigestSendResult =
  | { sent: true }
  | { sent: false; skipped: true; reason: DigestSkipReason }
  | { sent: false; error: string };

/**
 * Send a news digest email for one league.
 *
 * The daily cron and the "Send digest now" button run this exact same path; the
 * only difference is that a manual send skips the once-per-day dedupe check.
 * Dedupe is a read before building plus a write after Resend accepts the email,
 * so a crashed or timed-out run can always be retried on the next tick.
 */
export async function sendDigestForLeague(params: {
  leagueId: string;
  userId: string;
  now?: Date;
  force?: boolean;
}): Promise<DigestSendResult> {
  const now = params.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const fingerprint = params.force
    ? `digest:manual:${day}:${now.getTime()}`
    : `digest:${day}`;

  if (!params.force) {
    const alreadySent = await hasAlertSend({
      leagueId: params.leagueId,
      kind: "digest",
      fingerprint,
    });
    if (alreadySent) return { sent: false, skipped: true, reason: "already_sent" };
  }

  const email = await resolveUserEmail(params.userId);
  if (!email) return { sent: false, error: "no email" };

  // Refresh news first so the digest reflects the latest feed, not a cached one.
  invalidateNewsCache(params.leagueId);

  const name = await leagueName(params.leagueId);
  const scope = await loadRosterScopeAdmin(params.leagueId, params.userId);
  const { feed } = scope
    ? await buildNewsFeedForPlayers(scope.players, scope.playersById)
    : { feed: [] as Awaited<ReturnType<typeof buildNewsFeedForPlayers>>["feed"] };

  // A daily digest should only carry today's news, even though the page feed
  // keeps a longer history.
  const items = filterToDigestWindow(feed, now)
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

  // Nothing published in the window and no injury movement — skip rather than
  // emailing an empty digest. Not recorded, so a later run can still send.
  if (items.length === 0 && injuryLines.length === 0) {
    return { sent: false, skipped: true, reason: "no_recent_news" };
  }

  const itemsWithExcerpts = await buildDigestExcerpts(items);

  const { subject, text, html } = formatDigestEmail({
    leagueName: name,
    appUrl: appBaseUrl(),
    leagueId: params.leagueId,
    items: itemsWithExcerpts,
    injuryLines,
    lookbackHours: DIGEST_LOOKBACK_HOURS,
  });

  const result = await sendEmail({ to: email, subject, text, html });
  if (!result.ok) return { sent: false, error: result.error };

  await recordAlertSend({
    leagueId: params.leagueId,
    userId: params.userId,
    kind: "digest",
    fingerprint,
    subject,
  });
  return { sent: true };
}

/**
 * Send daily digests for every league with digest enabled.
 * Vercel Hobby only allows one daily cron tick — filtering by digest_hour_utc
 * would silently skip anyone who picked a different hour in the UI.
 */
export async function runDailyDigestsForCurrentHour(now = new Date()): Promise<{
  hourUtc: number;
  lookbackHours: number;
  leagues: number;
  sent: number;
  skipped: number;
  alreadySent: number;
  noRecentNews: number;
  errors: string[];
}> {
  const hourUtc = now.getUTCHours();
  let leagues: Awaited<ReturnType<typeof listDigestEnabledLeagues>>;
  try {
    leagues = await listDigestEnabledLeagues();
  } catch (err) {
    return {
      hourUtc,
      lookbackHours: DIGEST_LOOKBACK_HOURS,
      leagues: 0,
      sent: 0,
      skipped: 0,
      alreadySent: 0,
      noRecentNews: 0,
      errors: [err instanceof Error ? err.message : "Failed to list digest leagues"],
    };
  }
  let sent = 0;
  let alreadySent = 0;
  let noRecentNews = 0;
  const errors: string[] = [];

  for (const prefs of leagues) {
    try {
      const result = await sendDigestForLeague({
        leagueId: prefs.leagueId,
        userId: prefs.userId,
        now,
      });
      if (result.sent) sent += 1;
      else if ("skipped" in result && result.skipped) {
        if (result.reason === "already_sent") alreadySent += 1;
        else noRecentNews += 1;
      } else if ("error" in result && result.error) {
        errors.push(`${prefs.leagueId}: ${result.error}`);
      }
    } catch (err) {
      errors.push(
        `${prefs.leagueId}: ${err instanceof Error ? err.message : "digest failed"}`,
      );
    }
  }

  return {
    hourUtc,
    lookbackHours: DIGEST_LOOKBACK_HOURS,
    leagues: leagues.length,
    sent,
    skipped: alreadySent + noRecentNews,
    alreadySent,
    noRecentNews,
    errors,
  };
}
