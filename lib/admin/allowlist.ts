/**
 * Shared admin allowlist. Keep in sync with privileged server features.
 * Safe to import from Server Components / server actions only if callers
 * do not expose the list to clients unnecessarily — the check itself is fine
 * on the server.
 */

export const ADMIN_EMAILS = ["yenathan537@gmail.com"] as const;

const ADMIN_EMAIL_SET = new Set(
  ADMIN_EMAILS.map((email) => email.trim().toLowerCase()),
);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAIL_SET.has(email.trim().toLowerCase());
}
