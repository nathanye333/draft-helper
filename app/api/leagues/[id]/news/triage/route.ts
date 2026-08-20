import { NextResponse } from "next/server";
import { z } from "zod";
import { invalidateNewsCache } from "@/lib/news/cache";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  newsItemId: z.string().uuid(),
  status: z.enum(["read", "dismissed", "actioned", "new"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leagueId } = await params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!league) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  const { error } = await supabase.from("news_triage_state").upsert(
    {
      user_id: userData.user.id,
      league_id: leagueId,
      news_item_id: body.data.newsItemId,
      status: body.data.status,
    },
    { onConflict: "user_id,league_id,news_item_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateNewsCache(leagueId);
  return NextResponse.json({ ok: true });
}
