export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10" role="status" aria-live="polite">
      <div className="mb-6 h-8 w-48 animate-pulse rounded bg-slate-800" />
      <div className="mb-4 h-4 w-72 animate-pulse rounded bg-slate-900" />
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-lg bg-slate-900/80" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-900/80" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-900/80" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
