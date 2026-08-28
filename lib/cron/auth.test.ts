import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeCronRequest } from "./auth";

describe("authorizeCronRequest", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows missing secret outside production", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const req = new Request("http://localhost/api/cron/news-digest");
    expect(authorizeCronRequest(req)).toEqual({ ok: true });
  });

  it("rejects missing secret in production", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("http://localhost/api/cron/news-digest");
    expect(authorizeCronRequest(req)).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("accepts bearer token with optional whitespace", () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("http://localhost/api/cron/news-digest", {
      headers: { authorization: "Bearer  test-secret  " },
    });
    expect(authorizeCronRequest(req)).toEqual({ ok: true });
  });

  it("rejects wrong bearer token", () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.stubEnv("NODE_ENV", "production");
    const req = new Request("http://localhost/api/cron/news-digest", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(authorizeCronRequest(req)).toEqual({ ok: false, reason: "unauthorized" });
  });
});
