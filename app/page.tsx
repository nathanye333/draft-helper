import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Draft } from "@/lib/supabase/types";

const STATUS_VARIANT: Record<Draft["status"], "default" | "success" | "warning"> = {
  setup: "warning",
  live: "success",
  complete: "default",
};

const STATUS_HREF: Record<Draft["status"], (id: string) => string> = {
  setup: (id) => `/drafts/${id}/setup`,
  live: (id) => `/drafts/${id}`,
  complete: (id) => `/drafts/${id}/analysis`,
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect("/login");
  }

  const { data: drafts } = await supabase
    .from("drafts")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your drafts</h1>
        <Link href="/drafts/new" className={buttonVariants()}>
          New draft
        </Link>
      </div>

      {!drafts || drafts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No drafts yet. Create one to configure your league and sync rankings.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(drafts as Draft[]).map((draft) => (
            <Link key={draft.id} href={STATUS_HREF[draft.status](draft.id)}>
              <Card className="transition-colors hover:border-slate-700">
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>{draft.name}</CardTitle>
                    <p className="text-sm text-slate-400">
                      {draft.season} · {draft.num_teams} teams · {draft.scoring}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[draft.status]}>{draft.status}</Badge>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
