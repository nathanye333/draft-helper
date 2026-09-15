/**
 * Server-only helpers for optional env-backed OpenAI defaults.
 * Never import this into client components.
 */

import { isAdminEmail } from "@/lib/admin/allowlist";

export function emailHasServerOpenAiDefault(email: string | null | undefined): boolean {
  return isAdminEmail(email);
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
