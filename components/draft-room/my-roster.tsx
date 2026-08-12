import type { RosterSlotVM } from "@/lib/draft/view";

export function MyRoster({ teamName, slots }: { teamName: string; slots: RosterSlotVM[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">{teamName}</h3>
      <div className="flex flex-col gap-2">
        {slots.map((slot) => (
          <div key={slot.slotType} className="flex items-start gap-2 text-sm">
            <span className="w-12 shrink-0 font-medium text-slate-400">{slot.slotType}</span>
            <div className="flex flex-wrap gap-x-3 text-slate-200">
              {slot.playerNames.map((name, i) => (
                <span key={i} className={name ? "" : "text-slate-600"}>
                  {name ?? "__"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
