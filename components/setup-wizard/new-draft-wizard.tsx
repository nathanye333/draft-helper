"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDraft } from "@/app/actions/draft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ScoringFormat, SlotType } from "@/lib/supabase/types";
import { DEFAULT_ROSTER_SLOTS } from "@/lib/supabase/types";

interface TeamDraft {
  name: string;
  draftPosition: number;
  isUserTeam: boolean;
}

interface RosterSlotDraft {
  slotType: SlotType;
  count: number;
  sortOrder: number;
}

const ALL_SLOT_TYPES: SlotType[] = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST", "BENCH"];

function buildDefaultTeams(numTeams: number): TeamDraft[] {
  return Array.from({ length: numTeams }, (_, i) => ({
    name: `Team ${i + 1}`,
    draftPosition: i + 1,
    isUserTeam: i === 0,
  }));
}

export function NewDraftWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("My Fantasy Draft");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [numTeams, setNumTeams] = useState(10);
  const [scoring, setScoring] = useState<ScoringFormat>("PPR");

  const [teams, setTeams] = useState<TeamDraft[]>(buildDefaultTeams(10));
  const [rosterSlots, setRosterSlots] = useState<RosterSlotDraft[]>(
    DEFAULT_ROSTER_SLOTS.map((s) => ({ slotType: s.slot_type, count: s.count, sortOrder: s.sort_order })),
  );

  function goToStep2() {
    setTeams(buildDefaultTeams(numTeams));
    setStep(2);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const { draftId } = await createDraft({
        name,
        season,
        numTeams,
        scoring,
        teams,
        rosterSlots: rosterSlots.filter((s) => s.count > 0),
      });
      router.push(`/drafts/${draftId}/setup`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create draft");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">New draft</h1>
      <p className="mb-6 text-sm text-slate-400">Step {step} of 3</p>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>League basics</CardTitle>
            <CardDescription>Name your draft and set the league format.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Draft name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="season">Season</Label>
                <Input
                  id="season"
                  type="number"
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="numTeams"># of teams</Label>
                <Input
                  id="numTeams"
                  type="number"
                  min={2}
                  max={20}
                  value={numTeams}
                  onChange={(e) => setNumTeams(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="scoring">Scoring</Label>
              <Select
                id="scoring"
                value={scoring}
                onChange={(e) => setScoring(e.target.value as ScoringFormat)}
              >
                <option value="STD">Standard</option>
                <option value="PPR">PPR</option>
                <option value="HALF">Half-PPR</option>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button onClick={goToStep2} disabled={!name || numTeams < 2}>
                Next: Teams
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Teams</CardTitle>
            <CardDescription>
              Name each team in draft order and mark which one is yours (used for recommendations).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {teams.map((team, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-6 text-sm text-slate-500">{team.draftPosition}.</span>
                <Input
                  value={team.name}
                  onChange={(e) => {
                    const next = [...teams];
                    next[i] = { ...next[i], name: e.target.value };
                    setTeams(next);
                  }}
                />
                <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-300">
                  <input
                    type="radio"
                    name="userTeam"
                    checked={team.isUserTeam}
                    onChange={() =>
                      setTeams(teams.map((t, j) => ({ ...t, isUserTeam: j === i })))
                    }
                  />
                  My team
                </label>
              </div>
            ))}
            <div className="mt-2 flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>Next: Roster slots</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Roster slots</CardTitle>
            <CardDescription>Configure how many of each slot each team starts/benches.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {ALL_SLOT_TYPES.map((slotType) => {
              const slot = rosterSlots.find((s) => s.slotType === slotType);
              return (
                <div key={slotType} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-200">{slotType}</span>
                  <Input
                    type="number"
                    min={0}
                    max={15}
                    className="w-20"
                    value={slot?.count ?? 0}
                    onChange={(e) => {
                      const count = Number(e.target.value);
                      setRosterSlots((prev) => {
                        const exists = prev.find((s) => s.slotType === slotType);
                        if (exists) {
                          return prev.map((s) => (s.slotType === slotType ? { ...s, count } : s));
                        }
                        return [...prev, { slotType, count, sortOrder: ALL_SLOT_TYPES.indexOf(slotType) }];
                      });
                    }}
                  />
                </div>
              );
            })}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="mt-2 flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Creating…" : "Create draft"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
