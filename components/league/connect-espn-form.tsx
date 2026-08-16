"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewEspnLeague, connectLeague } from "@/app/actions/league";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type TeamOption = { espnTeamId: number; name: string; abbrev: string | null };

export function ConnectEspnForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [espnLeagueId, setEspnLeagueId] = useState("");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [swid, setSwid] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [name, setName] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [myEspnTeamId, setMyEspnTeamId] = useState<number | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [scoring, setScoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"creds" | "team">("creds");

  function onPreview() {
    setError(null);
    startTransition(async () => {
      const result = await previewEspnLeague({
        espnLeagueId: espnLeagueId.trim(),
        season,
        swid: swid.trim(),
        espnS2: espnS2.trim(),
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setTeams(result.teams);
      setPreviewName(result.name);
      setScoring(result.scoring);
      setMyEspnTeamId(result.teams[0]?.espnTeamId ?? null);
      setStep("team");
    });
  }

  function onConnect() {
    if (myEspnTeamId == null) {
      setError("Pick your team");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await connectLeague({
        espnLeagueId: espnLeagueId.trim(),
        season,
        swid: swid.trim(),
        espnS2: espnS2.trim(),
        myEspnTeamId,
        name: name.trim() || undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/leagues/${result.leagueId}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect ESPN league</CardTitle>
        <p className="text-sm text-slate-400">
          Paste cookies from espn.com while logged in (DevTools → Application → Cookies).
          Look for <code className="text-slate-300">SWID</code> and{" "}
          <code className="text-slate-300">espn_s2</code>. Private leagues require both.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === "creds" ? (
          <>
            <div>
              <Label htmlFor="leagueId">ESPN league ID</Label>
              <Input
                id="leagueId"
                value={espnLeagueId}
                onChange={(e) => setEspnLeagueId(e.target.value)}
                placeholder="From league URL leagueId="
              />
            </div>
            <div>
              <Label htmlFor="season">Season</Label>
              <Input
                id="season"
                type="number"
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="swid">SWID</Label>
              <Input
                id="swid"
                value={swid}
                onChange={(e) => setSwid(e.target.value)}
                placeholder="{XXXXXXXX-...}"
              />
            </div>
            <div>
              <Label htmlFor="espnS2">espn_s2</Label>
              <Input
                id="espnS2"
                value={espnS2}
                onChange={(e) => setEspnS2(e.target.value)}
                placeholder="Long cookie value"
              />
            </div>
            <div>
              <Label htmlFor="name">Display name (optional)</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My league"
              />
            </div>
            <Button
              type="button"
              disabled={pending || !espnLeagueId || !swid || !espnS2}
              onClick={onPreview}
            >
              {pending ? "Checking ESPN…" : "Validate & continue"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-300">
              {previewName} · {scoring}
            </p>
            <div>
              <Label htmlFor="team">Your team</Label>
              <select
                id="team"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                value={myEspnTeamId ?? ""}
                onChange={(e) => setMyEspnTeamId(Number(e.target.value))}
              >
                {teams.map((t) => (
                  <option key={t.espnTeamId} value={t.espnTeamId}>
                    {t.name}
                    {t.abbrev ? ` (${t.abbrev})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={() => setStep("creds")}>
                Back
              </Button>
              <Button type="button" disabled={pending || myEspnTeamId == null} onClick={onConnect}>
                {pending ? "Syncing…" : "Connect & sync"}
              </Button>
            </div>
          </>
        )}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
