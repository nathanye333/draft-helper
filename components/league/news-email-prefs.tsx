"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Prefs {
  digestEnabled: boolean;
  instantEnabled: boolean;
  digestHourUtc: number;
  lastDigestSentAt: string | null;
  accountEmail: string | null;
  prefsSaved: boolean;
}

/** Matches vercel.json news-digest cron (Hobby: once daily). */
const DIGEST_CRON_HOUR_UTC = 13;

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return "Unknown";
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NewsEmailPrefs({ leagueId }: { leagueId: string }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const saveSeq = useRef(0);

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

  const persist = useCallback(
    async (next: Prefs, opts?: { silent?: boolean }) => {
      const seq = ++saveSeq.current;
      if (!opts?.silent) setSaving(true);
      setError(null);
      if (!opts?.silent) setSaved(false);
      setSendStatus(null);
      try {
        const res = await fetch(`/api/leagues/${leagueId}/news/email-prefs`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            digestEnabled: next.digestEnabled,
            instantEnabled: next.instantEnabled,
            digestHourUtc: DIGEST_CRON_HOUR_UTC,
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(json?.error ?? "Failed to save");
        }
        const json = (await res.json()) as Omit<Prefs, "lastDigestSentAt" | "accountEmail" | "prefsSaved">;
        if (seq !== saveSeq.current) return;
        setPrefs((prev) =>
          prev
            ? {
                ...prev,
                ...json,
                prefsSaved: true,
              }
            : {
                ...json,
                lastDigestSentAt: null,
                accountEmail: null,
                prefsSaved: true,
              },
        );
        if (!opts?.silent) setSaved(true);
      } catch (err) {
        if (seq !== saveSeq.current) return;
        setError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        if (seq === saveSeq.current && !opts?.silent) setSaving(false);
      }
    },
    [leagueId],
  );

  const updatePref = (patch: Partial<Pick<Prefs, "digestEnabled" | "instantEnabled">>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void persist(next, { silent: true });
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
      void load();
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

  const digestActive = prefs.prefsSaved && prefs.digestEnabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-400">
          Daily digest to{" "}
          <span className="text-slate-300">{prefs.accountEmail ?? "your account email"}</span> around
          13:00 UTC (~9 AM ET). Instant alerts cover Reddit spikes and urgent ESPN injury jumps.
        </p>
        {!prefs.prefsSaved && prefs.digestEnabled ? (
          <p className="text-sm text-amber-400/90">Saving your preferences…</p>
        ) : null}
        {prefs.prefsSaved && !prefs.digestEnabled ? (
          <p className="text-sm text-amber-400/90">
            Daily digest is off — enable below to receive emails.
          </p>
        ) : null}
        {digestActive ? (
          <p className="text-xs text-slate-500">
            Last digest sent: {formatRelativeTime(prefs.lastDigestSentAt)}
            {prefs.lastDigestSentAt ? null : " — use Send digest now to test delivery."}
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={prefs.digestEnabled}
            disabled={saving || sending}
            onChange={(e) => updatePref({ digestEnabled: e.target.checked })}
          />
          Daily news digest
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={prefs.instantEnabled}
            disabled={saving || sending}
            onChange={(e) => updatePref({ instantEnabled: e.target.checked })}
          />
          Instant alerts (Reddit spikes + injury jumps)
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving || sending}
            onClick={() => void sendNow()}
          >
            {sending ? "Sending…" : "Send digest now"}
          </Button>
          {saving ? <span className="text-xs text-slate-500">Saving…</span> : null}
          {saved ? <span className="text-xs text-emerald-400">Saved</span> : null}
          {sendStatus ? <span className="text-xs text-emerald-400">{sendStatus}</span> : null}
          {error ? <span className="text-xs text-red-400">{error}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
