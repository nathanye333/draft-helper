"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SlotType } from "@/lib/supabase/types";
import { isStarterSlot } from "@/lib/league/slot-order";
import {
  assignPlayersToSeats,
  buildSeatsFromSlots,
  movePlayerToSeat,
  playerEligibleForSlot,
  publishWorkingLineup,
  seatsToWorkingLineup,
  starterProjectedPoints,
  type LineupSeat,
} from "@/lib/league/working-lineup";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StartSitPlayerView = {
  espnPlayerId: number;
  name: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  headshotUrl: string | null;
  weekProjected: number | null;
  weekActual: number | null;
  seasonProjected: number | null;
  seasonActual: number | null;
  percentOwned: number | null;
  percentStarted: number | null;
  lineupSlot: string;
};

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

function seedSeats(
  rosterSlots: { slot_type: SlotType; count: number }[],
  players: StartSitPlayerView[],
): LineupSeat[] {
  return assignPlayersToSeats(
    buildSeatsFromSlots(rosterSlots),
    players.map((p) => ({ espnPlayerId: p.espnPlayerId, slot: p.lineupSlot })),
  );
}

export function StartSitBoard({
  leagueId,
  currentWeek,
  rosterSlots,
  recommended,
  espnSynced,
  notes,
}: {
  leagueId: string;
  currentWeek: number | null;
  rosterSlots: { slot_type: SlotType; count: number }[];
  recommended: StartSitPlayerView[];
  espnSynced: StartSitPlayerView[];
  notes: string[];
}) {
  const playersById = useMemo(() => {
    const map = new Map(recommended.map((p) => [p.espnPlayerId, p]));
    for (const p of espnSynced) {
      if (!map.has(p.espnPlayerId)) map.set(p.espnPlayerId, p);
    }
    return map;
  }, [recommended, espnSynced]);

  const weekProjById = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const p of playersById.values()) m.set(p.espnPlayerId, p.weekProjected);
    return m;
  }, [playersById]);

  const positionById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of playersById.values()) m.set(p.espnPlayerId, p.position);
    return m;
  }, [playersById]);

  const [seats, setSeats] = useState<LineupSeat[]>(() => seedSeats(rosterSlots, recommended));
  const [dragSeatId, setDragSeatId] = useState<string | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [mode, setMode] = useState<"recommended" | "espn" | "custom">("recommended");

  useEffect(() => {
    const meta = new Map(
      [...playersById.entries()].map(([id, p]) => [
        id,
        {
          name: p.name,
          position: p.position,
          nflTeam: p.nflTeam,
          weekProj: p.weekProjected,
          injuryStatus: p.injuryStatus,
        },
      ]),
    );
    publishWorkingLineup(leagueId, seatsToWorkingLineup(seats, meta));
  }, [seats, leagueId, playersById]);

  const starterPts = starterProjectedPoints(seats, weekProjById);
  const weekLabel = currentWeek != null ? `W${currentWeek}` : "Week";
  const dragFrom = dragSeatId ? seats.find((s) => s.seatId === dragSeatId) : null;
  const dragPos = dragFrom?.playerId != null ? positionById.get(dragFrom.playerId) ?? null : null;

  function applyRecommended() {
    setSeats(seedSeats(rosterSlots, recommended));
    setMode("recommended");
    setSelectedSeatId(null);
  }

  function applyEspn() {
    setSeats(seedSeats(rosterSlots, espnSynced));
    setMode("espn");
    setSelectedSeatId(null);
  }

  function tryMove(fromSeatId: string, toSeatId: string) {
    const next = movePlayerToSeat(seats, fromSeatId, toSeatId, positionById);
    if (!next) return;
    setSeats(next);
    setMode("custom");
    setSelectedSeatId(null);
    setDragSeatId(null);
  }

  function onSeatClick(seatId: string) {
    if (selectedSeatId == null) {
      const seat = seats.find((s) => s.seatId === seatId);
      if (seat?.playerId != null) setSelectedSeatId(seatId);
      return;
    }
    if (selectedSeatId === seatId) {
      setSelectedSeatId(null);
      return;
    }
    tryMove(selectedSeatId, seatId);
  }

  const sections: { title: string; seatTypes: (s: LineupSeat) => boolean }[] = [
    { title: "Starters", seatTypes: (s) => isStarterSlot(s.slotType) },
    { title: "Bench", seatTypes: (s) => s.slotType === "BENCH" },
    { title: "IR", seatTypes: (s) => s.slotType === "IR" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-300">
          <span className="font-semibold tabular-nums text-slate-50">{starterPts.toFixed(1)}</span>
          {" "}
          projected starter pts
          {mode === "custom" ? (
            <span className="ml-2 text-xs text-amber-400">· sandbox (not saved to ESPN)</span>
          ) : mode === "espn" ? (
            <span className="ml-2 text-xs text-slate-500">· ESPN lineup</span>
          ) : (
            <span className="ml-2 text-xs text-slate-500">· recommended</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={applyRecommended}>
            Use recommendation
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={applyEspn}>
            Reset to ESPN
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Drag players between slots, or click one seat then another to swap/move. Changes are
        temporary — the season agent sees this arrangement.
      </p>

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
            {sections.map((section) => {
              const sectionSeats = seats.filter(section.seatTypes);
              if (sectionSeats.length === 0) return null;
              const filled = sectionSeats.filter((s) => s.playerId != null);
              const sectionProj = filled.reduce(
                (sum, s) => sum + (weekProjById.get(s.playerId!) ?? 0),
                0,
              );
              return (
                <SeatSection
                  key={section.title}
                  title={section.title}
                  seats={sectionSeats}
                  playersById={playersById}
                  leagueId={leagueId}
                  dragSeatId={dragSeatId}
                  selectedSeatId={selectedSeatId}
                  dragPos={dragPos}
                  showTotals={section.title !== "IR" || filled.length > 0}
                  sectionProj={sectionProj}
                  onDragStart={setDragSeatId}
                  onDragEnd={() => setDragSeatId(null)}
                  onDrop={(to) => {
                    if (dragSeatId) tryMove(dragSeatId, to);
                  }}
                  onClick={onSeatClick}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {notes.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-400">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SeatSection({
  title,
  seats,
  playersById,
  leagueId,
  dragSeatId,
  selectedSeatId,
  dragPos,
  showTotals,
  sectionProj,
  onDragStart,
  onDragEnd,
  onDrop,
  onClick,
}: {
  title: string;
  seats: LineupSeat[];
  playersById: Map<number, StartSitPlayerView>;
  leagueId: string;
  dragSeatId: string | null;
  selectedSeatId: string | null;
  dragPos: string | null;
  showTotals: boolean;
  sectionProj: number;
  onDragStart: (seatId: string) => void;
  onDragEnd: () => void;
  onDrop: (toSeatId: string) => void;
  onClick: (seatId: string) => void;
}) {
  return (
    <>
      <tr className="bg-slate-950">
        <td
          colSpan={8}
          className="px-3 py-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase"
        >
          {title}
        </td>
      </tr>
      {seats.map((seat) => {
        const p = seat.playerId != null ? playersById.get(seat.playerId) : null;
        const dragging = dragSeatId === seat.seatId;
        const selected = selectedSeatId === seat.seatId;
        const dropOk =
          dragSeatId != null &&
          dragSeatId !== seat.seatId &&
          dragPos != null &&
          playerEligibleForSlot(dragPos, seat.slotType);

        return (
          <tr
            key={seat.seatId}
            draggable={p != null}
            onDragStart={(e) => {
              if (!p) return;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/seat-id", seat.seatId);
              onDragStart(seat.seatId);
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
              if (!dropOk) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/seat-id") || dragSeatId;
              if (from) onDrop(seat.seatId);
            }}
            onClick={() => onClick(seat.seatId)}
            className={cn(
              "cursor-pointer border-t border-slate-800/80 hover:bg-slate-900/50",
              dragging && "opacity-50",
              selected && "bg-sky-950/40 ring-1 ring-inset ring-sky-700/60",
              dropOk && "bg-emerald-950/20",
            )}
          >
            <td className="px-3 py-2 text-xs font-medium text-slate-400">{seat.slotType}</td>
            <td className="px-2 py-2">
              {p ? (
                <Link
                  href={`/leagues/${leagueId}/players/${p.espnPlayerId}`}
                  className="flex items-center gap-2.5"
                  onClick={(e) => e.stopPropagation()}
                  draggable={false}
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
              ) : (
                <span className="text-sm text-slate-600">—</span>
              )}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-slate-100">
              {p?.weekProjected != null ? p.weekProjected.toFixed(1) : "—"}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-slate-400">
              {p?.weekActual != null ? p.weekActual.toFixed(1) : "—"}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-slate-400">
              {p?.percentOwned != null ? p.percentOwned.toFixed(1) : "—"}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-slate-400">
              {p?.percentStarted != null ? p.percentStarted.toFixed(1) : "—"}
            </td>
            <td className="px-2 py-2 text-right tabular-nums text-slate-300">
              {p?.seasonProjected != null ? p.seasonProjected.toFixed(1) : "—"}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-slate-400">
              {p?.seasonActual != null ? p.seasonActual.toFixed(1) : "—"}
            </td>
          </tr>
        );
      })}
      {showTotals ? (
        <tr className="border-t border-slate-700 bg-slate-900/80 text-xs font-medium text-slate-300">
          <td className="px-3 py-2" colSpan={2}>
            {title} total
          </td>
          <td className="px-2 py-2 text-right tabular-nums">{sectionProj.toFixed(1)}</td>
          <td className="px-2 py-2" colSpan={5} />
        </tr>
      ) : null}
    </>
  );
}
