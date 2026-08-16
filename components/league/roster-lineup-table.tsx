import Link from "next/link";
import { Fragment } from "react";
import {
  compareLineupSlots,
  isStarterSlot,
  sectionForSlot,
  type LineupSection,
} from "@/lib/league/slot-order";
import { cn } from "@/lib/utils";

export interface LineupPlayerRow {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  lineupSlot: string;
  headshotUrl: string | null;
  injuryStatus: string | null;
  weekProjected: number | null;
  weekActual: number | null;
  seasonProjected: number | null;
  seasonActual: number | null;
  percentOwned: number | null;
  percentStarted: number | null;
  opponent?: string | null;
}

function Headshot({ url, name }: { url: string | null; name: string }) {
  return (
    <span className="inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-slate-700 bg-slate-800">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover object-top" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
          {name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

function TotalsRow({
  label,
  rows,
}: {
  label: string;
  rows: LineupPlayerRow[];
}) {
  const sum = (key: keyof LineupPlayerRow) =>
    rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
  const hasProj = rows.some((r) => r.weekProjected != null);
  const hasSeason = rows.some((r) => r.seasonProjected != null);
  return (
    <tr className="border-t border-slate-700 bg-slate-900/80 text-xs font-medium text-slate-300">
      <td className="px-3 py-2" colSpan={2}>
        {label}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {hasProj ? sum("weekProjected").toFixed(1) : "—"}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-slate-500">
        {rows.some((r) => r.weekActual != null) ? sum("weekActual").toFixed(1) : "—"}
      </td>
      <td className="px-2 py-2" />
      <td className="px-2 py-2" />
      <td className="px-2 py-2 text-right tabular-nums">
        {hasSeason ? sum("seasonProjected").toFixed(1) : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
        {rows.some((r) => r.seasonActual != null) ? sum("seasonActual").toFixed(1) : "—"}
      </td>
    </tr>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr className="bg-slate-950">
      <td colSpan={8} className="px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        {title}
      </td>
    </tr>
  );
}

function emptyIrRow(): LineupPlayerRow {
  return {
    espnPlayerId: 0,
    name: "",
    position: "",
    nflTeam: null,
    lineupSlot: "IR",
    headshotUrl: null,
    injuryStatus: null,
    weekProjected: null,
    weekActual: null,
    seasonProjected: null,
    seasonActual: null,
    percentOwned: null,
    percentStarted: null,
  };
}

function padIrRows(filled: LineupPlayerRow[], irSlotCount: number): LineupPlayerRow[] {
  if (irSlotCount <= 0) return filled;
  const rows = [...filled];
  while (rows.length < irSlotCount) rows.push(emptyIrRow());
  return rows;
}

export function RosterLineupTable({
  leagueId,
  players,
  currentWeek,
  irSlotCount = 2,
  emptyMessage = "No players on this roster.",
}: {
  leagueId: string;
  players: LineupPlayerRow[];
  currentWeek: number | null;
  /** League IR capacity from ESPN settings (typically 2). */
  irSlotCount?: number;
  emptyMessage?: string;
}) {
  const sorted = [...players].sort((a, b) => {
    const sec =
      (sectionForSlot(a.lineupSlot) === "STARTERS" ? 0 : sectionForSlot(a.lineupSlot) === "BENCH" ? 1 : 2) -
      (sectionForSlot(b.lineupSlot) === "STARTERS" ? 0 : sectionForSlot(b.lineupSlot) === "BENCH" ? 1 : 2);
    if (sec !== 0) return sec;
    return compareLineupSlots(a.lineupSlot, b.lineupSlot) || a.name.localeCompare(b.name);
  });

  const irFilled = sorted.filter((p) => p.lineupSlot === "IR");
  const irRows = padIrRows(irFilled, irSlotCount);

  const sections: { key: LineupSection; title: string; rows: LineupPlayerRow[]; showTotals: boolean }[] = (
    [
      {
        key: "STARTERS" as const,
        title: "Starters",
        rows: sorted.filter((p) => isStarterSlot(p.lineupSlot)),
        showTotals: true,
      },
      {
        key: "BENCH" as const,
        title: "Bench",
        rows: sorted.filter((p) => p.lineupSlot === "BENCH"),
        showTotals: true,
      },
      {
        key: "IR" as const,
        title: "IR",
        rows: irRows,
        showTotals: irFilled.length > 0,
      },
    ] as { key: LineupSection; title: string; rows: LineupPlayerRow[]; showTotals: boolean }[]
  ).filter((s) => s.rows.length > 0);

  if (players.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-slate-500">{emptyMessage}</p>;
  }

  const weekLabel = currentWeek != null ? `W${currentWeek}` : "Week";

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[840px] text-left text-sm">
        <thead className="border-b border-slate-800 bg-slate-950/90 text-[10px] tracking-wide text-slate-500 uppercase">
          <tr>
            <th className="px-3 py-2.5 font-semibold">Slot</th>
            <th className="px-2 py-2.5 font-semibold">Player</th>
            <th className="px-2 py-2.5 text-right font-semibold">Proj {weekLabel}</th>
            <th className="px-2 py-2.5 text-right font-semibold">Score</th>
            <th className="px-2 py-2.5 text-right font-semibold">% Rost</th>
            <th className="px-2 py-2.5 text-right font-semibold">% Start</th>
            <th className="px-2 py-2.5 text-right font-semibold">Season Proj</th>
            <th className="px-3 py-2.5 text-right font-semibold">Season Act</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.key}>
              <SectionHeader title={section.title} />
              {section.rows.map((p, idx) => {
                const empty = !p.name;
                return (
                  <tr
                    key={
                      empty
                        ? `${section.key}-empty-${idx}`
                        : `${section.key}-${p.espnPlayerId}-${p.lineupSlot}-${idx}`
                    }
                    className="border-t border-slate-800/80 hover:bg-slate-900/50"
                  >
                    <td className="px-3 py-2 text-xs font-medium text-slate-400">{p.lineupSlot}</td>
                    <td className="px-2 py-2">
                      {empty ? (
                        <span className="text-sm text-slate-600">—</span>
                      ) : (
                        <Link
                          href={`/leagues/${leagueId}/players/${p.espnPlayerId}`}
                          className="flex items-center gap-2.5"
                        >
                          <Headshot url={p.headshotUrl} name={p.name} />
                          <span>
                            <span className="font-medium text-sky-400 hover:underline">{p.name}</span>
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {p.nflTeam ?? "FA"} {p.position}
                              {p.injuryStatus &&
                              !["ACTIVE", "NORMAL", "HEALTHY"].includes(p.injuryStatus.toUpperCase()) ? (
                                <span className="ml-1 text-amber-400">· {p.injuryStatus}</span>
                              ) : null}
                            </span>
                          </span>
                        </Link>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-100">
                      {p.weekProjected != null ? p.weekProjected.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                      {p.weekActual != null ? p.weekActual.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                      {p.percentOwned != null ? p.percentOwned.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                      {p.percentStarted != null ? p.percentStarted.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                      {p.seasonProjected != null ? p.seasonProjected.toFixed(1) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                      {p.seasonActual != null ? p.seasonActual.toFixed(1) : "—"}
                    </td>
                  </tr>
                );
              })}
              {section.showTotals ? (
                <TotalsRow
                  label={`${section.title} total`}
                  rows={section.rows.filter((r) => r.name)}
                />
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact status pill for Healthy / injury. */
export function HealthStatus({ status }: { status: string | null }) {
  const healthy =
    !status || ["ACTIVE", "NORMAL", "HEALTHY"].includes(status.toUpperCase());
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-300">
      <span
        className={cn("h-2 w-2 rounded-full", healthy ? "bg-emerald-400" : "bg-amber-400")}
      />
      {healthy ? "Healthy" : status}
    </span>
  );
}
