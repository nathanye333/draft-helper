import { LeagueRoutePrefetch } from "@/components/league/league-route-prefetch";
import { createClient } from "@/lib/supabase/server";

export default async function LeagueSegmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: league } = await supabase
    .from("leagues")
    .select("last_synced_at")
    .eq("id", id)
    .maybeSingle();

  const espnCached = Boolean(league?.last_synced_at);

  return (
    <>
      <LeagueRoutePrefetch leagueId={id} espnCached={espnCached} />
      {children}
    </>
  );
}
