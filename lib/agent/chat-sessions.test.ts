import { describe, expect, it } from "vitest";
import { titleFromFirstMessage } from "@/lib/agent/chat-sessions";

describe("titleFromFirstMessage", () => {
  it("uses the first line trimmed", () => {
    expect(titleFromFirstMessage("  Who are the top RBs?  ")).toBe("Who are the top RBs?");
  });

  it("truncates long titles", () => {
    const long = "a".repeat(80);
    expect(titleFromFirstMessage(long)).toHaveLength(58);
    expect(titleFromFirstMessage(long).endsWith("…")).toBe(true);
  });

  it("falls back for empty input", () => {
    expect(titleFromFirstMessage("   ")).toBe("New chat");
  });
});
