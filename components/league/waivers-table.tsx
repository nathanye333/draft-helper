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
  | "weekProjected"
  | "seasonActual"
  | "seasonProjected"
  | "ownership";

export function WaiversTable({
  leagueId,
  players,
  currentWeek,
}: {
  leagueId: string;
  players: WaiverRow[];
  currentWeek: number | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("weekProjected");
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

  function SortBtn({ k, label }: { k: SortKey; label: string }) {
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 hover:text-slate-200"
      >
        {label}
        {sortKey === k ? (
          <span className="text-emerald-400">{sortDir === "asc" ? "↑" : "↓"}</span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name / NFL team"
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm"
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
        <span className="self-center text-xs text-slate-500">
          {sorted.length} players · ESPN projections
          {currentWeek != null ? ` · week ${currentWeek}` : ""}
        </span>
      </div>

      <div className="max-h-[min(75vh,800px)] overflow-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 text-xs text-slate-500 backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-medium">Player</th>
              <th className="px-2 py-2 font-medium">
                <SortBtn k="position" label="Pos" />
              </th>
              <th className="px-2 py-2 font-medium">
                <SortBtn k="ownership" label="Status" />
              </th>
              <th className="px-2 py-2 text-right font-medium">
                <SortBtn k="percentOwned" label="% own" />
              </th>
              <th className="px-2 py-2 text-right font-medium">
                <SortBtn
                  k="weekProjected"
                  label={currentWeek != null ? `ESPN W${currentWeek}` : "ESPN week"}
                />
              </th>
              <th className="px-2 py-2 text-right font-medium">
                <SortBtn k="seasonActual" label="ESPN YTD" />
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <SortBtn k="seasonProjected" label="ESPN ROS" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.espnPlayerId} className="border-b border-slate-900/80 hover:bg-slate-900/50">
                <td className="px-3 py-2">
                  <Link
                    href={`/leagues/${leagueId}/players/${p.espnPlayerId}`}
                    className="flex items-center gap-2 text-emerald-300 hover:underline"
                  >
                    <span className="inline-block h-8 w-10 shrink-0 overflow-hidden rounded bg-slate-900">
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
                      <span className="font-medium">{p.name}</span>
                      <span className="block text-xs text-slate-500">{p.nflTeam ?? "FA"}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-2 py-2 text-slate-400">{p.position}</td>
                <td className="px-2 py-2 text-xs text-slate-400">
                  {p.ownership === "WAIVERS" ? "Waivers" : "FA"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-400">
                  {p.percentOwned != null ? p.percentOwned.toFixed(1) : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {p.weekProjected != null ? p.weekProjected.toFixed(1) : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                  {p.seasonActual != null ? p.seasonActual.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                  {p.seasonProjected != null ? p.seasonProjected.toFixed(1) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No free agents cached. Sync ESPN to pull the player pool and projections.
          </p>
        ) : null}
      </div>
    </div>
  );
}
