"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type WaiverRow = {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  headshotUrl: string | null;
  ownership: string;
  percentOwned: number | null;
  percentStarted: number | null;
  weekProjected: number | null;
  weekActual: number | null;
  seasonProjected: number | null;
  seasonActual: number | null;
  injuryStatus: string | null;
};

type SortKey =
  | "name"
  | "position"
  | "percentOwned"
  | "percentStarted"
  | "weekProjected"
  | "seasonActual"
  | "seasonProjected"
  | "ownership";

export function WaiversTable({
  leagueId,
  players,
  currentWeek,
  season,
}: {
  leagueId: string;
  players: WaiverRow[];
  currentWeek: number | null;
  season: number | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("percentOwned");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  const positions = useMemo(() => {
    const set = new Set(players.map((p) => p.position));
    return ["ALL", ...[...set].sort()];
  }, [players]);

  const sorted = useMemo(() => {
    let list = [...players];
    if (posFilter !== "ALL") list = list.filter((p) => p.position === posFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.nflTeam?.toLowerCase().includes(q) ?? false),
      );
    }
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (typeof av === "string" && typeof bv === "string") cmp = av.localeCompare(bv);
      else cmp = (Number(av ?? -Infinity) || 0) - (Number(bv ?? -Infinity) || 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [players, sortKey, sortDir, posFilter, query]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "position" || key === "ownership" ? "asc" : "desc");
    }
  }

  function SortBtn({ k, label, className }: { k: SortKey; label: string; className?: string }) {
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-slate-200 ${className ?? ""}`}
      >
        {label}
        {sortKey === k ? (
          <span className="text-emerald-400">{sortDir === "asc" ? "↑" : "↓"}</span>
        ) : null}
      </button>
    );
  }

  const weekLabel = currentWeek != null ? `NFL WEEK ${currentWeek}` : "THIS WEEK";
  const seasonLabel = season != null ? `${season} PROJECTIONS` : "SEASON PROJECTIONS";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-600"
        />
        <select
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
        >
          {positions.map((p) => (
            <option key={p} value={p}>
              {p === "ALL" ? "All positions" : p}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{sorted.length} available</span>
      </div>

      <div className="max-h-[min(75vh,840px)] overflow-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-950/95 text-[10px] tracking-wide text-slate-500 uppercase backdrop-blur">
            <tr className="border-b border-slate-800">
              <th className="px-3 py-2 font-semibold" rowSpan={2}>
                <SortBtn k="name" label="Players" />
              </th>
              <th
                className="border-l border-slate-800 px-2 py-1.5 text-center font-semibold"
                colSpan={2}
              >
                Status
              </th>
              <th
                className="border-l border-slate-800 px-2 py-1.5 text-center font-semibold"
                colSpan={4}
              >
                {weekLabel}
              </th>
              <th
                className="border-l border-slate-800 px-2 py-1.5 text-center font-semibold"
                colSpan={3}
              >
                {seasonLabel}
              </th>
            </tr>
            <tr className="border-b border-slate-800">
              <th className="border-l border-slate-800 px-2 py-1.5 font-semibold">
                <SortBtn k="ownership" label="Type" />
              </th>
              <th className="px-2 py-1.5 font-semibold">
                <SortBtn k="position" label="Pos" />
              </th>
              <th className="border-l border-slate-800 px-2 py-1.5 text-right font-semibold">
                <SortBtn k="weekProjected" label="Proj" />
              </th>
              <th className="px-2 py-1.5 text-right font-semibold">Score</th>
              <th className="px-2 py-1.5 text-right font-semibold">
                <SortBtn k="percentOwned" label="%Rost" />
              </th>
              <th className="px-2 py-1.5 text-right font-semibold">
                <SortBtn k="percentStarted" label="%Start" />
              </th>
              <th className="border-l border-slate-800 px-2 py-1.5 text-right font-semibold">
                <SortBtn k="seasonProjected" label="FPTS" />
              </th>
              <th className="px-2 py-1.5 text-right font-semibold">Avg</th>
              <th className="px-3 py-1.5 text-right font-semibold">
                <SortBtn k="seasonActual" label="YTD" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const seasonAvg =
                p.seasonProjected != null ? p.seasonProjected / 17 : null;
              return (
                <tr
                  key={p.espnPlayerId}
                  className={
                    i % 2 === 0
                      ? "border-b border-slate-900/80 bg-slate-950/40 hover:bg-slate-900/60"
                      : "border-b border-slate-900/80 hover:bg-slate-900/60"
                  }
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/leagues/${leagueId}/players/${p.espnPlayerId}`}
                      className="flex items-center gap-2.5"
                    >
                      <span className="inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                        {p.headshotUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.headshotUrl}
                            alt=""
                            className="h-full w-full object-cover object-top"
                          />
                        ) : null}
                      </span>
                      <span>
                        <span className="font-medium text-sky-400 hover:underline">{p.name}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {p.nflTeam ?? "FA"} {p.position}
                          {p.injuryStatus &&
                          !["ACTIVE", "NORMAL", "HEALTHY"].includes(p.injuryStatus.toUpperCase()) ? (
                            <span className="ml-1 text-red-400">{p.injuryStatus}</span>
                          ) : null}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="border-l border-slate-900 px-2 py-2 text-xs text-slate-400">
                    {p.ownership === "WAIVERS" ? "WA" : "FA"}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-400">{p.position}</td>
                  <td className="border-l border-slate-900 px-2 py-2 text-right tabular-nums">
                    {p.weekProjected != null ? p.weekProjected.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                    {p.weekActual != null ? p.weekActual.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                    {p.percentOwned != null ? p.percentOwned.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                    {p.percentStarted != null ? p.percentStarted.toFixed(1) : "—"}
                  </td>
                  <td className="border-l border-slate-900 px-2 py-2 text-right tabular-nums text-slate-200">
                    {p.seasonProjected != null ? p.seasonProjected.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                    {seasonAvg != null ? seasonAvg.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {p.seasonActual != null ? p.seasonActual.toFixed(1) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            No free agents cached. Sync ESPN to load the player pool.
          </p>
        ) : null}
      </div>
    </div>
  );
}
