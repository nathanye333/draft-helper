import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import {
  ANALYSIS_SQL_TOOL_NAMES,
  messagesHaveAnalysisSchema,
} from "@/lib/agent/analysis-schema-context";

describe("messagesHaveAnalysisSchema", () => {
  it("is false until a schema unlock tool result exists", () => {
    expect(
      messagesHaveAnalysisSchema([
        new HumanMessage("rank defenses vs RBs"),
        new AIMessage("checking"),
      ]),
    ).toBe(false);
  });

  it("unlocks after analysis_schema tool message", () => {
    expect(
      messagesHaveAnalysisSchema([
        new HumanMessage("rank defenses vs RBs"),
        new ToolMessage({
          content: "tables...",
          tool_call_id: "1",
          name: "analysis_schema",
        }),
      ]),
    ).toBe(true);
  });

  it("unlocks after analysis_describe_table", () => {
    expect(
      messagesHaveAnalysisSchema([
        new ToolMessage({
          content: "cols",
          tool_call_id: "2",
          name: "analysis_describe_table",
        }),
      ]),
    ).toBe(true);
  });
});

describe("ANALYSIS_SQL_TOOL_NAMES", () => {
  it("gates sql runners only", () => {
    expect(ANALYSIS_SQL_TOOL_NAMES.has("analysis_sql")).toBe(true);
    expect(ANALYSIS_SQL_TOOL_NAMES.has("analysis_write_csv")).toBe(true);
    expect(ANALYSIS_SQL_TOOL_NAMES.has("analysis_schema")).toBe(false);
  });
});
