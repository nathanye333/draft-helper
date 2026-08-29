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

const feedItem = {
  id: "hash-1",
  title: "Star RB questionable",
  url: "https://example.com/rb",
  snippet: "He is questionable for Sunday.",
  source: "espn",
  severity: "questionable",
  bucket: "needs_action",
  score: 20,
  publishedAt: null,
  matchedPlayers: [{ espnPlayerId: 1, name: "Star RB", scope: "roster" }],
  corroborationCount: 1,
  triageStatus: "new",
};

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
    mocks.buildNewsFeedForPlayers.mockResolvedValue([feedItem]);
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

    expect(result).toEqual({ sent: false, skipped: true });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.buildNewsFeedForPlayers).not.toHaveBeenCalled();
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
