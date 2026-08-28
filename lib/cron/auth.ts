export type CronAuthFailure = "missing_secret" | "unauthorized";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; reason: CronAuthFailure };

/** Verify Vercel cron Authorization bearer token. */
export function authorizeCronRequest(request: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, reason: "missing_secret" };
  }

  const auth = request.headers.get("authorization")?.trim();
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (token === secret) return { ok: true };

  return { ok: false, reason: "unauthorized" };
}

export function cronAuthErrorResponse(reason: CronAuthFailure): Response {
  if (reason === "missing_secret") {
    return Response.json(
      {
        error: "Cron not configured",
        hint: "Set CRON_SECRET in Vercel project env (Production). Vercel sends Authorization: Bearer <CRON_SECRET> on scheduled invocations.",
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      error: "Unauthorized",
      hint: "Cron requests must include Authorization: Bearer <CRON_SECRET>.",
    },
    { status: 401 },
  );
}
