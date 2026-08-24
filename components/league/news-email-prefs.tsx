"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

interface Prefs {
  digestEnabled: boolean;
  instantEnabled: boolean;
  digestHourUtc: number;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

function formatHourLabel(hourUtc: number): string {
  const et = (hourUtc - 4 + 24) % 24; // rough EDT offset for label only
  const ampm = et >= 12 ? "PM" : "AM";
  const h12 = et % 12 === 0 ? 12 : et % 12;
  return `${hourUtc}:00 UTC (~${h12} ${ampm} ET)`;
}

export function NewsEmailPrefs({ leagueId }: { leagueId: string }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/news/email-prefs`);
      if (!res.ok) throw new Error("Failed to load email prefs");
      const json = (await res.json()) as Prefs;
      setPrefs(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prefs");
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/news/email-prefs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? "Failed to save");
      }
      const json = (await res.json()) as Prefs;
      setPrefs(json);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-slate-500">
          {error ?? "Loading email alerts…"}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-400">
          Daily digest to your account email, plus near-instant alerts for Reddit spikes on your
          players and urgent ESPN injury status jumps (OUT / IR / Doubtful).
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={prefs.digestEnabled}
            onChange={(e) =>
              setPrefs((p) => (p ? { ...p, digestEnabled: e.target.checked } : p))
            }
          />
          Daily news digest
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={prefs.instantEnabled}
            onChange={(e) =>
              setPrefs((p) => (p ? { ...p, instantEnabled: e.target.checked } : p))
            }
          />
          Instant alerts (Reddit spikes + injury jumps)
        </label>
        <div>
          <label className="mb-1 block text-xs text-slate-500">Digest send hour</label>
          <Select
            value={String(prefs.digestHourUtc)}
            onChange={(e) =>
              setPrefs((p) =>
                p ? { ...p, digestHourUtc: Number(e.target.value) } : p,
              )
            }
            className="w-64"
            disabled={!prefs.digestEnabled}
          >
            {HOUR_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {formatHourLabel(h)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save alerts"}
          </Button>
          {saved ? <span className="text-xs text-emerald-400">Saved</span> : null}
          {error ? <span className="text-xs text-red-400">{error}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
