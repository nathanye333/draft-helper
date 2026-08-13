import { createAgent, HumanMessage, AIMessage, ToolMessage } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import { createChatModel, type LlmConfig } from "@/lib/agent/model";
import { createDraftTools } from "@/lib/agent/tools";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCallTrace {
  name: string;
  input: unknown;
  output: string;
}

export interface AgentRunResult {
  reply: string;
  toolCalls: ToolCallTrace[];
}

function systemPrompt(draftId: string): string {
  return [
    "You are a fantasy football draft analyst for this user's live snake draft.",
    `Draft id: ${draftId}.`,
    "Use tools to inspect rankings, availability, recommendations, and scarcity before answering.",
    "Prefer draft database tools for ADP/ECR/availability. Use web_search only for news/injuries/context.",
    "Cite ADP/ECR numbers from tool results. Never invent rankings or claim a player is available without checking.",
    "Keep answers concise and decision-oriented for the current pick.",
    "You are read-only: you cannot log or undo picks.",
  ].join(" ");
}

function toLangChainMessages(messages: ChatTurn[]): BaseMessage[] {
  return messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content),
  );
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return content == null ? "" : String(content);
}

function collectToolCalls(messages: BaseMessage[]): ToolCallTrace[] {
  const traces: ToolCallTrace[] = [];
  for (const msg of messages) {
    if (ToolMessage.isInstance(msg)) {
      traces.push({
        name: msg.name ?? "tool",
        input: msg.additional_kwargs?.input ?? null,
        output: extractText(msg.content),
      });
    }
  }
  return traces;
}

/** Enrich tool traces with AIMessage tool_call args when ToolMessage lacks input. */
function enrichToolCalls(messages: BaseMessage[]): ToolCallTrace[] {
  const callArgs = new Map<string, { name: string; args: unknown }>();
  for (const msg of messages) {
    if (AIMessage.isInstance(msg) && Array.isArray(msg.tool_calls)) {
      for (const call of msg.tool_calls) {
        if (call.id) {
          callArgs.set(call.id, { name: call.name, args: call.args });
        }
      }
    }
  }

  const traces: ToolCallTrace[] = [];
  for (const msg of messages) {
    if (!ToolMessage.isInstance(msg)) continue;
    const meta = msg.tool_call_id ? callArgs.get(msg.tool_call_id) : undefined;
    traces.push({
      name: meta?.name ?? msg.name ?? "tool",
      input: meta?.args ?? null,
      output: extractText(msg.content).slice(0, 4000),
    });
  }
  return traces;
}

export async function runDraftChatAgent(params: {
  draftId: string;
  messages: ChatTurn[];
  llm: LlmConfig;
}): Promise<AgentRunResult> {
  const model = createChatModel(params.llm);
  const tools = createDraftTools(params.draftId);

  const agent = createAgent({
    model,
    tools,
    systemPrompt: systemPrompt(params.draftId),
  });

  const result = await agent.invoke({
    messages: toLangChainMessages(params.messages),
  });

  const resultMessages = (result.messages ?? []) as BaseMessage[];
  const lastAi = [...resultMessages].reverse().find((m) => AIMessage.isInstance(m));
  const reply = lastAi ? extractText(lastAi.content) : "No response from the model.";
  const toolCalls = enrichToolCalls(resultMessages);

  // Fallback if enrich found nothing but tools ran
  if (toolCalls.length === 0) {
    return { reply, toolCalls: collectToolCalls(resultMessages) };
  }

  return { reply, toolCalls };
}
