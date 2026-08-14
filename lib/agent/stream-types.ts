/** NDJSON events for the draft-room chat stream (shared client/server). */
export type DraftAgentStreamEvent =
  | { type: "session"; sessionId: string }
  | { type: "reasoning"; delta: string }
  | { type: "token"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; output: string }
  | { type: "error"; message: string }
  | { type: "done"; stopped?: boolean };
