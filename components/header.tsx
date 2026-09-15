import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";
import { isAdminEmail } from "@/lib/admin/allowlist";

export async function Header() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const showAdmin = isAdminEmail(data.user?.email);

  return (
    <header className="border-b border-slate-800 bg-slate-950">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold text-slate-100">
          Fantasy Helper
        </Link>
        {data.user ? (
          <div className="flex items-center gap-3">
            <Link href="/leagues" className="text-xs text-slate-400 hover:text-slate-200">
              Leagues
            </Link>
            <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">
              Drafts
            </Link>
            {showAdmin ? (
              <Link href="/admin" className="text-xs text-slate-400 hover:text-slate-200">
                Admin
              </Link>
            ) : null}
            <span className="text-xs text-slate-500">{data.user.email}</span>
            <SignOutButton />
          </div>
        ) : (
          <Link href="/login" className="text-sm text-slate-300 hover:text-slate-100">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
