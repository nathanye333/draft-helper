import type { PositionScarcity } from "@/lib/analytics/scarcity";
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<PositionScarcity["status"], string> = {
  run: "Run on this position",
  falling: "Falling behind ADP",
  normal: "Normal pace",
};

const STATUS_VARIANT: Record<PositionScarcity["status"], "danger" | "info" | "default"> = {
  run: "danger",
  falling: "info",
  normal: "default",
};

export function ScarcityAlerts({ scarcity }: { scarcity: PositionScarcity[] }) {
  const notable = scarcity.filter((s) => s.status !== "normal");

  return (
    <div className="flex flex-col gap-2">
      {notable.length === 0 && (
        <p className="text-sm text-slate-500">No position runs detected yet.</p>
      )}
      {notable.map((s) => (
        <div key={s.position} className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-200">{s.position}</span>
          <span className="text-xs text-slate-500">
            {s.draftedCount}/{s.expectedCount} drafted vs. ADP pace
          </span>
          <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
        </div>
      ))}
    </div>
  );
}
