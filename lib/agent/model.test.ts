import { describe, expect, it } from "vitest";
import {
  isReasoningCapableModel,
  reasoningForToolCallingModel,
  temperatureForModel,
} from "@/lib/agent/model";

describe("temperatureForModel", () => {
  it("uses 1 for reasoning / fixed-temperature models", () => {
    expect(temperatureForModel("o4-mini")).toBe(1);
    expect(temperatureForModel("o3")).toBe(1);
    expect(temperatureForModel("o1-preview")).toBe(1);
    expect(temperatureForModel("gpt-5")).toBe(1);
    expect(temperatureForModel("gpt-5-mini")).toBe(1);
    expect(temperatureForModel("gpt-5.6-luna")).toBe(1);
  });

  it("uses 0.2 for standard chat models", () => {
    expect(temperatureForModel("gpt-4o-mini")).toBe(0.2);
    expect(temperatureForModel("gpt-4.1")).toBe(0.2);
    expect(temperatureForModel("llama3.1")).toBe(0.2);
    expect(temperatureForModel("gpt-5-chat")).toBe(0.2);
  });
});

describe("reasoningForToolCallingModel", () => {
  it("forces reasoning effort none for tool-calling reasoning models", () => {
    expect(reasoningForToolCallingModel("gpt-5.6-luna")).toEqual({ effort: "none" });
    expect(reasoningForToolCallingModel("o4-mini")).toEqual({ effort: "none" });
    expect(reasoningForToolCallingModel("gpt-4o-mini")).toBeUndefined();
    expect(isReasoningCapableModel("gpt-5.6-luna")).toBe(true);
    expect(isReasoningCapableModel("gpt-5-chat")).toBe(false);
  });
});
