"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Prefs {
  digestEnabled: boolean;
  instantEnabled: boolean;
  digestHourUtc: number;
}

/** Matches vercel.json news-digest cron (Hobby: once daily). */
const DIGEST_CRON_HOUR_UTC = 13;

export function NewsEmailPrefs({ leagueId }: { leagueId: string }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);

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
    setSendStatus(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/news/email-prefs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...prefs,
          // Persist the cron hour so prefs stay aligned with the daily schedule.
          digestHourUtc: DIGEST_CRON_HOUR_UTC,
        }),
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

  const sendNow = async () => {
    setSending(true);
    setError(null);
    setSaved(false);
    setSendStatus(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/news/send-digest`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        sent?: boolean;
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to send digest");
      }
      setSendStatus("Digest emailed to your account address.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send digest");
    } finally {
      setSending(false);
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
          Daily digest to your account email around 13:00 UTC (~9 AM ET), plus alerts for Reddit
          spikes on your players and urgent ESPN injury status jumps (OUT / IR / Doubtful). Injury
          alerts fire on ESPN sync; Reddit spikes are checked on the daily cron (more frequent
          polling on Vercel Pro).
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
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" disabled={saving || sending} onClick={() => void save()}>
            {saving ? "Saving…" : "Save alerts"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving || sending}
            onClick={() => void sendNow()}
          >
            {sending ? "Sending…" : "Send digest now"}
          </Button>
          {saved ? <span className="text-xs text-emerald-400">Saved</span> : null}
          {sendStatus ? <span className="text-xs text-emerald-400">{sendStatus}</span> : null}
          {error ? <span className="text-xs text-red-400">{error}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
