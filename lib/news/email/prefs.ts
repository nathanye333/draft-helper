import { createAdminClient } from "@/lib/supabase/admin";

export type NewsAlertKind = "digest" | "reddit_spike" | "injury_delta";

export interface NewsEmailPrefs {
  leagueId: string;
  userId: string;
  digestEnabled: boolean;
  instantEnabled: boolean;
  digestHourUtc: number;
}

export async function getLeagueEmailPrefs(leagueId: string): Promise<NewsEmailPrefs | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("league_news_email_prefs")
    .select("league_id, user_id, digest_enabled, instant_enabled, digest_hour_utc")
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!data) return null;
  return {
    leagueId: String(data.league_id),
    userId: String(data.user_id),
    digestEnabled: Boolean(data.digest_enabled),
    instantEnabled: Boolean(data.instant_enabled),
    digestHourUtc: Number(data.digest_hour_utc),
  };
}

export async function listInstantEnabledLeagues(): Promise<NewsEmailPrefs[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("league_news_email_prefs")
    .select("league_id, user_id, digest_enabled, instant_enabled, digest_hour_utc")
    .eq("instant_enabled", true);
  return (data ?? []).map((row) => ({
    leagueId: String(row.league_id),
    userId: String(row.user_id),
    digestEnabled: Boolean(row.digest_enabled),
    instantEnabled: Boolean(row.instant_enabled),
    digestHourUtc: Number(row.digest_hour_utc),
  }));
}

/** All leagues with daily digest enabled (Hobby cron fires once/day — do not filter by hour). */
export async function listDigestEnabledLeagues(): Promise<NewsEmailPrefs[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("league_news_email_prefs")
    .select("league_id, user_id, digest_enabled, instant_enabled, digest_hour_utc")
    .eq("digest_enabled", true);
  return (data ?? []).map((row) => ({
    leagueId: String(row.league_id),
    userId: String(row.user_id),
    digestEnabled: Boolean(row.digest_enabled),
    instantEnabled: Boolean(row.instant_enabled),
    digestHourUtc: Number(row.digest_hour_utc),
  }));
}

/** Returns true if this fingerprint is new (row inserted); false if already sent. */
export async function claimAlertSend(params: {
  leagueId: string;
  userId: string;
  kind: NewsAlertKind;
  fingerprint: string;
  subject: string;
}): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("news_alert_sends").insert({
    league_id: params.leagueId,
    user_id: params.userId,
    kind: params.kind,
    fingerprint: params.fingerprint,
    subject: params.subject,
  });
  if (!error) return true;
  // unique violation → already emailed
  if (error.code === "23505") return false;
  console.warn("[claimAlertSend]", error.message);
  return false;
}

/** Drop a claim so a failed send can be retried (e.g. missing Resend key). */
export async function releaseAlertSend(params: {
  leagueId: string;
  kind: NewsAlertKind;
  fingerprint: string;
}): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("news_alert_sends")
    .delete()
    .eq("league_id", params.leagueId)
    .eq("kind", params.kind)
    .eq("fingerprint", params.fingerprint);
  if (error) console.warn("[releaseAlertSend]", error.message);
}

export async function resolveUserEmail(userId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user?.email) return null;
  return data.user.email;
}
