import type { Recommendation } from "@/lib/analytics/recommendations";

export function RecommendationsPanel({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return <p className="text-sm text-slate-500">No recommendations yet — sync rankings to enable this.</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {recommendations.map((rec, i) => (
        <li key={rec.fpPlayerId} className="flex items-baseline gap-2 text-sm">
          <span className="text-slate-500">{i + 1}.</span>
          <span className="font-medium text-slate-100">{rec.name}</span>
          <span className="text-xs text-slate-500">({rec.rationale})</span>
        </li>
      ))}
    </ol>
  );
}
