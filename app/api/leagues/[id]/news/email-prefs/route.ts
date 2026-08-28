import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLastDigestSentAt } from "@/lib/news/email/prefs";

const bodySchema = z.object({
  digestEnabled: z.boolean(),
  instantEnabled: z.boolean(),
  digestHourUtc: z.number().int().min(0).max(23).default(13),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!league) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data } = await supabase
    .from("league_news_email_prefs")
    .select("digest_enabled, instant_enabled, digest_hour_utc")
    .eq("league_id", leagueId)
    .maybeSingle();

  const lastDigestSentAt = await getLastDigestSentAt(leagueId);

  return NextResponse.json({
    digestEnabled: Boolean(data?.digest_enabled),
    instantEnabled: Boolean(data?.instant_enabled),
    digestHourUtc: data?.digest_hour_utc != null ? Number(data.digest_hour_utc) : 13,
    lastDigestSentAt,
    accountEmail: userData.user.email ?? null,
    prefsSaved: Boolean(data),
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!league) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { digestEnabled, instantEnabled, digestHourUtc } = parsed.data;
  const { error } = await supabase.from("league_news_email_prefs").upsert(
    {
      league_id: leagueId,
      user_id: userData.user.id,
      digest_enabled: digestEnabled,
      instant_enabled: instantEnabled,
      digest_hour_utc: digestHourUtc,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "league_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    digestEnabled,
    instantEnabled,
    digestHourUtc,
  });
}
