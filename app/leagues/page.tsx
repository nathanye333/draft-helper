import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteLeagueButton } from "@/components/league/delete-league-button";
import type { League } from "@/lib/supabase/types";

export default async function LeaguesPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: leagues } = await supabase
    .from("leagues")
    .select("*")
    .order("updated_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Season leagues</h1>
          <p className="text-sm text-slate-400">ESPN-synced advisor (start/sit, trades, waivers)</p>
        </div>
        <Link href="/leagues/new" className={buttonVariants()}>
          Connect ESPN
        </Link>
      </div>

      {!leagues || leagues.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No leagues yet. Connect an ESPN league with your SWID / espn_s2 cookies.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(leagues as League[]).map((league) => (
            <Card key={league.id} className="transition-colors hover:border-slate-700">
              <CardHeader className="flex-row items-center justify-between gap-3">
                <Link href={`/leagues/${league.id}`} className="min-w-0 flex-1">
                  <CardTitle>{league.name}</CardTitle>
                  <p className="text-sm text-slate-400">
                    {league.season} · {league.scoring}
                    {league.current_week != null ? ` · Week ${league.current_week}` : ""}
                    {league.last_synced_at
                      ? ` · synced ${new Date(league.last_synced_at).toLocaleString()}`
                      : " · never synced"}
                  </p>
                </Link>
                <DeleteLeagueButton leagueId={league.id} leagueName={league.name} />
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
