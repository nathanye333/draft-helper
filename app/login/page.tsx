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
  const [status, setStatus] = useState<"idle" | "loading" | "confirm" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Fantasy Draft Helper</CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "Sign in with your email and password."
              : "Create an account to manage your drafts."}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              {status === "error" && errorMessage && (
                <p className="text-sm text-red-400">{errorMessage}</p>
              )}
              <Button type="submit" disabled={status === "loading"}>
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
