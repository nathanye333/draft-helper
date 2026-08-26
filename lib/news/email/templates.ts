import type { NewsItemView } from "@/lib/news/types";
import type { RedditSpikePost } from "@/lib/news/reddit-spikes";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatRedditSpikeEmail(params: {
  leagueName: string;
  appUrl: string;
  leagueId: string;
  posts: RedditSpikePost[];
}): { subject: string; text: string; html: string } {
  const top = params.posts[0]!;
  const players = [...new Set(params.posts.flatMap((p) => p.matchedPlayers.map((m) => m.name)))];
  const subject = `Reddit spike: ${players.slice(0, 2).join(", ") || top.title.slice(0, 60)}`;

  const lines = params.posts.map(
    (p) =>
      `• ${p.title}\n  ${p.score} ups · ${p.numComments} comments · r/${p.subreddit}\n  Players: ${p.matchedPlayers.map((m) => m.name).join(", ")}\n  ${p.url}`,
  );

  const text = [
    `Reddit spike alert for ${params.leagueName}`,
    "",
    ...lines,
    "",
    `Open news triage: ${params.appUrl}/leagues/${params.leagueId}/news`,
  ].join("\n");

  const htmlItems = params.posts
    .map(
      (p) => `<li style="margin-bottom:12px">
  <a href="${escapeHtml(p.url)}"><strong>${escapeHtml(p.title)}</strong></a><br/>
  <span style="color:#64748b">${p.score} ups · ${p.numComments} comments · r/${escapeHtml(p.subreddit)}</span><br/>
  Players: ${escapeHtml(p.matchedPlayers.map((m) => m.name).join(", "))}
</li>`,
    )
    .join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.45;color:#0f172a">
  <h2 style="margin:0 0 8px">Reddit spike — ${escapeHtml(params.leagueName)}</h2>
  <p style="color:#475569;margin:0 0 16px">Rising discussion matching your roster / watchlist.</p>
  <ul style="padding-left:18px">${htmlItems}</ul>
  <p><a href="${escapeHtml(params.appUrl)}/leagues/${params.leagueId}/news">Open news triage</a></p>
</div>`;

  return { subject, text, html };
}

export function formatInjuryDeltaEmail(params: {
  leagueName: string;
  appUrl: string;
  leagueId: string;
  deltas: Array<{
    playerName: string;
    fromStatus: string | null;
    toStatus: string;
    isStarter?: boolean;
  }>;
}): { subject: string; text: string; html: string } {
  const names = params.deltas.map((d) => d.playerName);
  const subject = `Injury alert: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`;

  const lines = params.deltas.map(
    (d) =>
      `• ${d.playerName}${d.isStarter ? " (starter)" : ""}: ${d.fromStatus ?? "—"} → ${d.toStatus}`,
  );

  const text = [
    `Injury status change for ${params.leagueName}`,
    "",
    ...lines,
    "",
    `Open news triage: ${params.appUrl}/leagues/${params.leagueId}/news`,
  ].join("\n");

  const htmlItems = params.deltas
    .map(
      (d) => `<li style="margin-bottom:8px">
  <strong>${escapeHtml(d.playerName)}</strong>${d.isStarter ? " <em>(starter)</em>" : ""}:
  ${escapeHtml(d.fromStatus ?? "—")} → <strong>${escapeHtml(d.toStatus)}</strong>
</li>`,
    )
    .join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.45;color:#0f172a">
  <h2 style="margin:0 0 8px">Injury alert — ${escapeHtml(params.leagueName)}</h2>
  <ul style="padding-left:18px">${htmlItems}</ul>
  <p><a href="${escapeHtml(params.appUrl)}/leagues/${params.leagueId}/news">Open news triage</a></p>
</div>`;

  return { subject, text, html };
}

export function formatDigestEmail(params: {
  leagueName: string;
  appUrl: string;
  leagueId: string;
  items: Array<
    Pick<NewsItemView, "title" | "url" | "bucket" | "severity" | "source" | "matchedPlayers" | "score"> & {
      /** Most relevant body/snippet excerpt for the email body. */
      excerpt?: string;
    }
  >;
  injuryLines: string[];
}): { subject: string; text: string; html: string } {
  const subject = `Daily fantasy news — ${params.leagueName}`;
  const top = params.items.slice(0, 12);

  const textLines = top.map((i) => {
    const players = i.matchedPlayers.map((p) => p.name).join(", ") || "—";
    const excerpt = i.excerpt?.trim();
    return [
      `• [${i.bucket}/${i.severity}] ${i.title}`,
      `  ${players}`,
      excerpt ? `  ${excerpt}` : null,
      `  ${i.url}`,
    ]
      .filter((l) => l != null)
      .join("\n");
  });

  const text = [
    `Daily news digest for ${params.leagueName}`,
    "",
    params.injuryLines.length ? "Injury board changes:" : null,
    ...params.injuryLines.map((l) => `• ${l}`),
    params.injuryLines.length ? "" : null,
    "Top stories:",
    ...textLines,
    "",
    `Open news triage: ${params.appUrl}/leagues/${params.leagueId}/news`,
  ]
    .filter((l) => l != null)
    .join("\n");

  const htmlItems = top
    .map((i) => {
      const excerpt = i.excerpt?.trim();
      return `<li style="margin-bottom:10px">
  <a href="${escapeHtml(i.url)}">${escapeHtml(i.title)}</a><br/>
  <span style="color:#64748b">${escapeHtml(i.bucket)} · ${escapeHtml(i.severity)} · ${escapeHtml(i.source)}</span>
  ${
    i.matchedPlayers.length
      ? `<br/>Players: ${escapeHtml(i.matchedPlayers.map((p) => p.name).join(", "))}`
      : ""
  }
  ${
    excerpt
      ? `<br/><span style="color:#334155">${escapeHtml(excerpt)}</span>`
      : ""
  }
</li>`;
    })
    .join("\n");

  const injuryHtml =
    params.injuryLines.length > 0
      ? `<h3 style="margin:16px 0 8px">Injury board</h3><ul>${params.injuryLines
          .map((l) => `<li>${escapeHtml(l)}</li>`)
          .join("")}</ul>`
      : "";

  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.45;color:#0f172a">
  <h2 style="margin:0 0 8px">Daily news — ${escapeHtml(params.leagueName)}</h2>
  ${injuryHtml}
  <h3 style="margin:16px 0 8px">Top stories</h3>
  <ul style="padding-left:18px">${htmlItems || "<li>No matching news in the last day.</li>"}</ul>
  <p><a href="${escapeHtml(params.appUrl)}/leagues/${params.leagueId}/news">Open news triage</a></p>
</div>`;

  return { subject, text, html };
}
