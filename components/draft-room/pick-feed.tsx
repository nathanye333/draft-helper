"use client";

import { useState } from "react";
import { ValueLabelBadge } from "@/components/value-label-badge";
import { classifyAdpDelta } from "@/lib/analytics/value";
import type { PickFeedVM } from "@/lib/draft/view";

export function PickFeed({ picks }: { picks: PickFeedVM[] }) {
  const [reachesOnly, setReachesOnly] = useState(false);

  const visible = [...picks].reverse().filter((p) => {
    if (!reachesOnly) return true;
    const label = classifyAdpDelta(p.adpDelta);
    return label !== "Fair" && label !== "No Data";
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Recent picks</h3>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={reachesOnly} onChange={(e) => setReachesOnly(e.target.checked)} />
          Reaches/falls only
        </label>
      </div>

      <ul className="flex max-h-[28rem] flex-col divide-y divide-slate-800 overflow-y-auto">
        {visible.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-100">
                <span className="text-slate-500">{p.pickNumber}.</span> {p.playerName}{" "}
                <span className="text-xs text-slate-500">({p.position})</span>
              </p>
              <p className="text-xs text-slate-500">
                {p.teamName}
                {p.isUserTeam ? " · you" : ""} · {p.assignedSlotType}
              </p>
            </div>
            <ValueLabelBadge adpDelta={p.adpDelta} />
          </li>
        ))}
        {visible.length === 0 && (
          <li className="py-4 text-center text-sm text-slate-500">No picks yet.</li>
        )}
      </ul>
    </div>
  );
}
