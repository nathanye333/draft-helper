/**
 * Server-only helpers for optional env-backed OpenAI defaults.
 * Never import this into client components.
 */

const SERVER_DEFAULT_OPENAI_EMAILS = new Set(["yenathan537@gmail.com"]);

export function emailHasServerOpenAiDefault(email: string | null | undefined): boolean {
  if (!email) return false;
  return SERVER_DEFAULT_OPENAI_EMAILS.has(email.trim().toLowerCase());
}

/** Prefer the client BYOK key; fall back to OPENAI_API_KEY for allowlisted emails only. */
export function resolveOpenAiApiKey(
  email: string | null | undefined,
  clientApiKey?: string | null,
): string | undefined {
  const fromClient = clientApiKey?.trim();
  if (fromClient) return fromClient;

  if (!emailHasServerOpenAiDefault(email)) return undefined;

  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  return fromEnv || undefined;
}

export function hasServerOpenAiDefaultConfigured(
  email: string | null | undefined,
): boolean {
  return Boolean(resolveOpenAiApiKey(email, undefined));
}
