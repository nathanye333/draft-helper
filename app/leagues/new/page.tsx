import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConnectEspnForm } from "@/components/league/connect-espn-form";

export default async function NewLeaguePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Connect ESPN</h1>
      <ConnectEspnForm />
    </div>
  );
}
