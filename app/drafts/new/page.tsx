import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewDraftWizard } from "@/components/setup-wizard/new-draft-wizard";

export default async function NewDraftPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  return <NewDraftWizard />;
}
