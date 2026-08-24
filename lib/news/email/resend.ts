/**
 * Thin Resend HTTP client (no SDK dependency).
 * Requires RESEND_API_KEY. Optional RESEND_FROM_EMAIL (default: onboarding@resend.dev).
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() || "Fantasy Draft Helper <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id ?? "unknown" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "email send failed",
    };
  }
}
