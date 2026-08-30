import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasAlertSend: vi.fn(),
  recordAlertSend: vi.fn(),
  resolveUserEmail: vi.fn(),
  sendEmail: vi.fn(),
  loadRosterScopeAdmin: vi.fn(),
  buildNewsFeedForPlayers: vi.fn(),
  invalidateNewsCache: vi.fn(),
  semanticExcerptsByUrlHash: vi.fn(),
  fetchArticleBody: vi.fn(),
  supabaseIn: vi.fn(),
}));

vi.mock("@/lib/news/email/prefs", () => ({
  hasAlertSend: mocks.hasAlertSend,
  recordAlertSend: mocks.recordAlertSend,
  resolveUserEmail: mocks.resolveUserEmail,
  claimAlertSend: vi.fn(),
  releaseAlertSend: vi.fn(),
  getLeagueEmailPrefs: vi.fn(),
  listDigestEnabledLeagues: vi.fn(),
  listInstantEnabledLeagues: vi.fn(),
}));

vi.mock("@/lib/news/email/resend", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/news/roster-scope-admin", () => ({
  loadRosterScopeAdmin: mocks.loadRosterScopeAdmin,
}));
vi.mock("@/lib/news/aggregate", () => ({
  buildNewsFeedForPlayers: mocks.buildNewsFeedForPlayers,
}));
vi.mock("@/lib/news/cache", () => ({ invalidateNewsCache: mocks.invalidateNewsCache }));
vi.mock("@/lib/news/body-chunks", () => ({
  semanticExcerptsByUrlHash: mocks.semanticExcerptsByUrlHash,
  keywordExcerptFallback: (text: string) => text ?? "",
  indexBodyChunks: vi.fn(),
}));
vi.mock("@/lib/news/article-body", () => ({
  fetchArticleBody: mocks.fetchArticleBody,
  sanitizeArticleText: (s: string | null | undefined) => s ?? null,
}));
vi.mock("@/lib/news/reddit-spikes", () => ({ detectRedditSpikesForPlayers: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: "Test League" } }) }),
        in: mocks.supabaseIn,
      }),
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }),
    }),
  }),
}));

function recentFeedItem(publishedAt: string | null = new Date().toISOString()) {
  return {
    id: "hash-1",
    title: "Star RB questionable",
    url: "https://example.com/rb",
    snippet: "He is questionable for Sunday.",
    source: "espn",
    severity: "questionable",
    bucket: "needs_action",
    score: 20,
    publishedAt,
    matchedPlayers: [{ espnPlayerId: 1, name: "Star RB", scope: "roster" }],
    corroborationCount: 1,
    triageStatus: "new",
  };
}

describe("sendDigestForLeague", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.hasAlertSend.mockResolvedValue(false);
    mocks.recordAlertSend.mockResolvedValue(undefined);
    mocks.resolveUserEmail.mockResolvedValue("owner@example.com");
    mocks.sendEmail.mockResolvedValue({ ok: true, id: "email-1" });
    mocks.loadRosterScopeAdmin.mockResolvedValue({
      players: [{ espnPlayerId: 1, name: "Star RB", scope: "roster", lineupSlot: "RB" }],
      playersById: new Map(),
      injuryDeltas: [],
    });
    mocks.buildNewsFeedForPlayers.mockResolvedValue([recentFeedItem()]);
    mocks.semanticExcerptsByUrlHash.mockResolvedValue(new Map());
    mocks.supabaseIn.mockResolvedValue({ data: [] });
  });

  it("refreshes news before building the digest", async () => {
    const { sendDigestForLeague } = await import("./alerts");
    await sendDigestForLeague({ leagueId: "l1", userId: "u1" });
    expect(mocks.invalidateNewsCache).toHaveBeenCalledWith("l1");
  });

  it("records the send only after the email is accepted", async () => {
    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1" });

    expect(result).toEqual({ sent: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.recordAlertSend).toHaveBeenCalledTimes(1);
    const sendOrder = mocks.sendEmail.mock.invocationCallOrder[0];
    const recordOrder = mocks.recordAlertSend.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(recordOrder);
  });

  it("does not record a send when Resend fails, so the next run retries", async () => {
    mocks.sendEmail.mockResolvedValue({ ok: false, error: "Resend 401" });
    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1" });

    expect(result).toEqual({ sent: false, error: "Resend 401" });
    expect(mocks.recordAlertSend).not.toHaveBeenCalled();
  });

  it("skips when today's digest was already sent", async () => {
    mocks.hasAlertSend.mockResolvedValue(true);
    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1" });

    expect(result).toEqual({ sent: false, skipped: true, reason: "already_sent" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.buildNewsFeedForPlayers).not.toHaveBeenCalled();
  });

  it("only includes articles published within the last day", async () => {
    mocks.buildNewsFeedForPlayers.mockResolvedValue([
      recentFeedItem(new Date().toISOString()),
      {
        ...recentFeedItem(new Date(Date.now() - 5 * 24 * 3600_000).toISOString()),
        id: "hash-old",
        url: "https://example.com/old",
        title: "Five day old story",
      },
    ]);

    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1" });

    expect(result).toEqual({ sent: true });
    const body = mocks.sendEmail.mock.calls[0]![0] as { text: string };
    expect(body.text).toContain("Star RB questionable");
    expect(body.text).not.toContain("Five day old story");
  });

  it("skips sending when nothing was published in the window", async () => {
    mocks.buildNewsFeedForPlayers.mockResolvedValue([
      recentFeedItem(new Date(Date.now() - 3 * 24 * 3600_000).toISOString()),
    ]);

    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1" });

    expect(result).toEqual({ sent: false, skipped: true, reason: "no_recent_news" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.recordAlertSend).not.toHaveBeenCalled();
  });

  it("still sends undated-article-only days when injuries moved", async () => {
    mocks.buildNewsFeedForPlayers.mockResolvedValue([recentFeedItem(null)]);
    mocks.loadRosterScopeAdmin.mockResolvedValue({
      players: [
        {
          espnPlayerId: 1,
          name: "Star RB",
          scope: "roster",
          lineupSlot: "RB",
          isStarter: true,
          injuryStatus: "OUT",
          position: "RB",
          nflTeam: "KC",
          headshotUrl: null,
        },
      ],
      playersById: new Map(),
      injuryDeltas: [
        {
          espnPlayerId: 1,
          playerName: "Star RB",
          fromStatus: "QUESTIONABLE",
          toStatus: "OUT",
          detectedAt: new Date().toISOString(),
        },
      ],
    });

    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1" });

    expect(result).toEqual({ sent: true });
  });

  it("force send ignores the daily dedupe check", async () => {
    mocks.hasAlertSend.mockResolvedValue(true);
    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1", force: true });

    expect(result).toEqual({ sent: true });
    expect(mocks.hasAlertSend).not.toHaveBeenCalled();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("still sends when excerpt enrichment throws", async () => {
    mocks.semanticExcerptsByUrlHash.mockRejectedValue(new Error("chunk table missing"));
    const { sendDigestForLeague } = await import("./alerts");
    const result = await sendDigestForLeague({ leagueId: "l1", userId: "u1" });

    expect(result).toEqual({ sent: true });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });
});
