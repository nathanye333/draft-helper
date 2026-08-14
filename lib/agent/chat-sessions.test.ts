import { describe, expect, it } from "vitest";
import {
  isDefaultSessionTitle,
  numberedSessionTitle,
  titleFromFirstMessage,
} from "@/lib/agent/chat-sessions";
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

describe("numberedSessionTitle", () => {
  it("increments from existing count", () => {
    expect(numberedSessionTitle(0)).toBe("Chat 1");
    expect(numberedSessionTitle(2)).toBe("Chat 3");
  });
});

describe("isDefaultSessionTitle", () => {
  it("matches numbered and legacy defaults", () => {
    expect(isDefaultSessionTitle("New chat")).toBe(true);
    expect(isDefaultSessionTitle("Chat 4")).toBe(true);
    expect(isDefaultSessionTitle("Top RB targets")).toBe(false);
  });
});
