import { describe, expect, it } from "vitest";
import { isAdminEmail, ADMIN_EMAILS } from "@/lib/admin/allowlist";

describe("admin allowlist", () => {
  it("allows the configured admin email case-insensitively", () => {
    expect(ADMIN_EMAILS).toContain("yenathan537@gmail.com");
    expect(isAdminEmail("yenathan537@gmail.com")).toBe(true);
    expect(isAdminEmail("Yenathan537@Gmail.com")).toBe(true);
    expect(isAdminEmail(" yenathan537@gmail.com ")).toBe(true);
  });

  it("rejects other emails", () => {
    expect(isAdminEmail("other@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });
});
