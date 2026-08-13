"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-lg px-4 py-16">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <pre className="mt-4 overflow-x-auto rounded-md border border-slate-800 bg-slate-900 p-3 text-xs text-red-300 whitespace-pre-wrap">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <div className="mt-6 flex gap-3">
            <Button type="button" onClick={reset}>
              Try again
            </Button>
            <Link href="/">
              <Button type="button" variant="secondary">
                Home
              </Button>
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
