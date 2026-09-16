import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin/allowlist";
import { loadSeasonMonitorSnapshot } from "@/lib/admin/season-monitor";
import { ForceSleepButton } from "@/components/admin/force-sleep-button";
import { AbilityDecisionButtons } from "@/components/admin/ability-decision-buttons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function pct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function num(n: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");
  if (!isAdminEmail(userData.user.email)) notFound();

  let snapshot;
  try {
    snapshot = await loadSeasonMonitorSnapshot();
  } catch (err) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-100">Season agent admin</h1>
        <p className="mt-3 text-sm text-red-400">
          Failed to load monitor data:{" "}
          {err instanceof Error ? err.message : "unknown error"}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          If tables are missing, apply migration{" "}
          <code className="text-slate-400">20260915000000_season_agent_self_improve.sql</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Season agent admin</h1>
        <p className="text-sm text-slate-400">
          Self-improvement monitor · last {snapshot.windowDays} days · skill v
          {snapshot.skill.version} ({snapshot.skill.status})
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>Global evidence across all users</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Metric label="Turns" value={String(snapshot.turns)} />
            <Metric label="Thumbs up" value={pct(snapshot.thumbsUpRate)} />
            <Metric label="Follow-up rate" value={pct(snapshot.followUpRate)} />
            <Metric
              label="Avg latency"
              value={
                snapshot.avgLatencyMs != null
                  ? `${Math.round(snapshot.avgLatencyMs)} ms`
                  : "—"
              }
            />
            <Metric label="Tool success" value={pct(snapshot.toolSuccessRate)} />
            <Metric label="Rec hit rate" value={pct(snapshot.recommendations.hitRate)} />
            <Metric label="Fixture score" value={num(snapshot.fixtureScore, 3)} />
            <Metric label="Composite" value={num(snapshot.composite, 3)} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Recs: {snapshot.recommendations.validated} validated ·{" "}
            {snapshot.recommendations.invalidated} invalidated ·{" "}
            {snapshot.recommendations.pending} pending/other
          </p>
          <pre className="mt-3 max-h-28 overflow-auto rounded-md border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-slate-400">
            {JSON.stringify(snapshot.breakdown, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Force sleep</CardTitle>
          <CardDescription>
            Run SkillOpt-Sleep now (force=true). Promotes only if gate improves.
            Workflow abilities may auto-accept; tool/schema stay proposed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForceSleepButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ability catalog</CardTitle>
          <CardDescription>
            Sleep proposals. Approve tool/schema for backlog only (no codegen).
            Workflows auto-accept when the skill gate passes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshot.abilities.length === 0 ? (
            <p className="text-sm text-slate-500">No abilities proposed yet.</p>
          ) : (
            snapshot.abilities.map((a) => (
              <div
                key={a.id}
                className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2 text-slate-300">
                  <span className="font-medium text-slate-100">{a.title}</span>
                  <span className="font-mono text-slate-500">{a.slug}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                    {a.ability_kind}
                  </span>
                  <span
                    className={
                      a.status === "accepted" || a.status === "approved"
                        ? "text-emerald-400"
                        : a.status === "rejected"
                          ? "text-rose-400"
                          : "text-amber-400"
                    }
                  >
                    {a.status}
                  </span>
                  <span className="text-slate-600">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">{a.description}</p>
                {a.skill_bullet ? (
                  <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500">
                    {a.skill_bullet}
                  </pre>
                ) : null}
                {a.ability_kind !== "workflow" ? (
                  <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-500">
                    {JSON.stringify(a.spec_json, null, 2)}
                  </pre>
                ) : null}
                {a.status === "proposed" &&
                (a.ability_kind === "tool" || a.ability_kind === "schema") ? (
                  <div className="mt-2">
                    <AbilityDecisionButtons abilityId={a.id} />
                  </div>
                ) : null}
                {a.decided_by ? (
                  <p className="mt-1 text-[10px] text-slate-600">
                    decided by {a.decided_by}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent skill edits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {snapshot.recentEdits.length === 0 ? (
            <p className="text-sm text-slate-500">No edit log rows yet.</p>
          ) : (
            snapshot.recentEdits.map((e, i) => (
              <div
                key={`${e.created_at}-${i}`}
                className="rounded-md border border-slate-800 bg-slate-950/40 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2 text-slate-300">
                  <span>
                    v{e.from_version ?? "?"} → v{e.to_version ?? "?"}
                  </span>
                  <span
                    className={
                      e.accepted ? "text-emerald-400" : "text-amber-400"
                    }
                  >
                    {e.accepted ? "accepted" : "rejected"}
                  </span>
                  <span className="text-slate-500">
                    gate {num(e.gate_score_before, 3)} → {num(e.gate_score_after, 3)}
                  </span>
                  <span className="text-slate-600">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                {e.reject_reason ? (
                  <p className="mt-1 text-slate-500">{e.reject_reason}</p>
                ) : null}
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-400">
                  {JSON.stringify(e.proposed_ops, null, 2)}
                </pre>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active skill</CardTitle>
          <CardDescription>
            Version {snapshot.skill.version} · {snapshot.skill.status}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/80 p-3 text-[11px] leading-relaxed text-slate-300">
            {snapshot.skill.content}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent recommendations</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {snapshot.recentRecommendations.length === 0 ? (
            <p className="text-sm text-slate-500">No recommendation claims yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Week</th>
                  <th className="py-2 pr-3 font-medium">Notes</th>
                  <th className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentRecommendations.map((r) => (
                  <tr key={r.id} className="border-b border-slate-900/80 align-top">
                    <td className="py-2 pr-3 font-mono">{r.claim_type}</td>
                    <td className="py-2 pr-3">{r.status}</td>
                    <td className="py-2 pr-3">{r.week ?? "—"}</td>
                    <td className="max-w-xs py-2 pr-3 text-slate-400">
                      {r.outcome_notes ?? "—"}
                      {r.failure_tags ? (
                        <div className="mt-0.5 text-[10px] text-slate-600">
                          {JSON.stringify(r.failure_tags)}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 whitespace-nowrap text-slate-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-medium text-slate-100">{value}</div>
    </div>
  );
}
