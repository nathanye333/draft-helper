import { createMiddleware, ToolMessage } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";

/** SQL runners — withheld until schema is already in the thread via a tool result. */
export const ANALYSIS_SQL_TOOL_NAMES = new Set(["analysis_sql", "analysis_write_csv"]);

/** Calling these puts schema in messages and unlocks SQL tools. */
export const ANALYSIS_SCHEMA_UNLOCK_NAMES = new Set([
  "analysis_schema",
  "analysis_describe_table",
]);

function toolName(tool: { name?: string }): string {
  return tool.name ?? "";
}

export function messagesHaveAnalysisSchema(messages: BaseMessage[]): boolean {
  for (const msg of messages) {
    if (!ToolMessage.isInstance(msg)) continue;
    const name = msg.name ?? "";
    if (ANALYSIS_SCHEMA_UNLOCK_NAMES.has(name)) return true;
  }
  return false;
}

/**
 * Withhold analysis_sql until analysis_schema (or describe) has returned.
 * Schema stays in that tool message — do not re-inject into the system prompt
 * on later model hops; the agent already sees prior tool results.
 */
export function createAnalysisSchemaMiddleware() {
  return createMiddleware({
    name: "AnalysisSchemaContext",
    wrapModelCall: async (request, handler) => {
      const ready = messagesHaveAnalysisSchema(request.messages);
      if (ready) return handler(request);

      return handler({
        ...request,
        tools: request.tools.filter((t) => !ANALYSIS_SQL_TOOL_NAMES.has(toolName(t))),
      });
    },
  });
}
