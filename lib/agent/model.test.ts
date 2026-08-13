import { describe, expect, it } from "vitest";
import { temperatureForModel } from "@/lib/agent/model";

describe("temperatureForModel", () => {
  it("uses 1 for reasoning / fixed-temperature models", () => {
    expect(temperatureForModel("o4-mini")).toBe(1);
    expect(temperatureForModel("o3")).toBe(1);
    expect(temperatureForModel("o1-preview")).toBe(1);
    expect(temperatureForModel("gpt-5")).toBe(1);
    expect(temperatureForModel("gpt-5-mini")).toBe(1);
  });

  it("uses 0.2 for standard chat models", () => {
    expect(temperatureForModel("gpt-4o-mini")).toBe(0.2);
    expect(temperatureForModel("gpt-4.1")).toBe(0.2);
    expect(temperatureForModel("llama3.1")).toBe(0.2);
  });
});
