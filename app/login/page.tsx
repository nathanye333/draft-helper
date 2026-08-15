"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "oauth" | "confirm" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setStatus("oauth");
    setErrorMessage(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage(null);

    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }
      // Project may require email confirmation before a session exists.
      if (!data.session) {
        setStatus("confirm");
        return;
      }
    }

    router.replace("/");
    router.refresh();
  }

  const busy = status === "loading" || status === "oauth";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Fantasy Draft Helper</CardTitle>
          <CardDescription>Sign in with Google to manage your drafts.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={handleGoogleSignIn}
            className="w-full"
          >
            <GoogleIcon />
            {status === "oauth" ? "Redirecting…" : "Continue with Google"}
          </Button>

          {status === "error" && errorMessage && (
            <p className="text-sm text-red-400">{errorMessage}</p>
          )}

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <div className="w-full border-t border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-wide">
              <span className="bg-slate-900 px-2 text-slate-500">or email</span>
            </div>
          </div>

          {status === "confirm" ? (
            <p className="text-sm text-emerald-400">
              Account created. Check <span className="font-medium">{email}</span> to confirm,
              then sign in.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" disabled={busy}>
                {status === "loading"
                  ? mode === "signin"
                    ? "Signing in…"
                    : "Creating account…"
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </Button>
              <button
                type="button"
                className="text-sm text-slate-400 hover:text-slate-200"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setStatus("idle");
                  setErrorMessage(null);
                }}
              >
                {mode === "signin"
                  ? "Need an account? Create one"
                  : "Already have an account? Sign in"}
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden className="size-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
