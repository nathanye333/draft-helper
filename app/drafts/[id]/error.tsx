"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DraftSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Draft page error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-xl font-semibold text-slate-100">This draft page failed to load</h1>
      <p className="mt-3 text-sm text-slate-400">
        Copy the error below if it keeps happening.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-md border border-slate-800 bg-slate-900 p-3 text-xs text-red-300 whitespace-pre-wrap">
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Link href="/">
          <Button type="button" variant="secondary">
            Back to drafts
          </Button>
        </Link>
      </div>
    </div>
  );
}
