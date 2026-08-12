import { Badge, type BadgeProps } from "@/components/ui/badge";
import { classifyAdpDelta } from "@/lib/analytics/value";

const VARIANT_BY_LABEL: Record<string, BadgeProps["variant"]> = {
  "Major Reach": "danger",
  Reach: "warning",
  Fair: "default",
  Value: "info",
  "Major Steal": "success",
  "No Data": "default",
};

export function ValueLabelBadge({ adpDelta }: { adpDelta: number | null }) {
  const label = classifyAdpDelta(adpDelta);
  return <Badge variant={VARIANT_BY_LABEL[label]}>{label}</Badge>;
}
