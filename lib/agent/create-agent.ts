import { createAgent, HumanMessage, AIMessage, ToolMessage } from "langchain";
import type { BaseMessage } from "@langchain/core/messages";
import { createChatModel, type LlmConfig } from "@/lib/agent/model";
import { createDraftTools } from "@/lib/agent/tools";
import { createLeagueTools } from "@/lib/agent/league-tools";
import type { DraftAgentStreamEvent } from "@/lib/agent/stream-types";
import type { WorkingLineupEntry } from "@/lib/league/working-lineup";

export type { DraftAgentStreamEvent } from "@/lib/agent/stream-types";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCallTrace {
  id?: string;
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
    "You are a fantasy football draft data analyst for this user's live snake draft.",
    `Draft id: ${draftId}.`,
    "All rankings and season projections are cached in Postgres from FantasyPros sync — query them with tools; do not invent numbers.",
    "Be decisive: call tools and give a clear recommendation or answer in one reply.",
    "Do not ask follow-up questions, clarifying questions, or 'would you like me to…' menus.",
    "If something is underspecified, state a short assumption and proceed (default: user's team, current pick, available players, this draft's scoring).",
    "Only ask a question when the request is truly unintelligible with no workable default.",
    "Start with get_draft_snapshot or query_players when you need board context; use list_dataset_columns only if a column name is unknown.",
    "Use query_players with orderBy/orderDir to sort by any column (projPoints, adpValue, rushYds, receptions, ecr, etc.).",
    "Prefer find_value_plays for ADP vs ECR gaps; analyze_roster for bye/position/projection roster health.",
    "Use web_search only for news/injuries/context outside the cached board — never for ADP/ECR/projections; keep web queries short and plain.",
    "If web_search returns no results, answer from draft tools and note that live news was unavailable; do not ask the user what to do next.",
    "Cite ADP/ECR/projPoints from tool results. Keep answers concise and decision-oriented.",
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
  if (content && typeof content === "object" && "content" in content) {
    return extractText((content as { content: unknown }).content);
  }
  return content == null ? "" : String(content);
}

function toolOutputToString(output: unknown, error?: string): string {
  if (error) return error;
  if (output === undefined) return "";
  return extractText(output).slice(0, 4000);
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
      id: msg.tool_call_id,
      name: meta?.name ?? msg.name ?? "tool",
      input: meta?.args ?? null,
      output: extractText(msg.content).slice(0, 4000),
    });
  }
  return traces;
}

function createAgentForDraft(draftId: string, llm: LlmConfig) {
  return createAgent({
    model: createChatModel(llm),
    tools: createDraftTools(draftId),
    systemPrompt: systemPrompt(draftId),
  });
}

function leagueSystemPrompt(
  leagueId: string,
  workingLineup?: WorkingLineupEntry[] | null,
): string {
  const parts = [
    "You are a fantasy football season advisor for this user's ESPN-synced league.",
    `League id: ${leagueId}.`,
    "Rosters come from ESPN sync; shared FantasyPros rankings + week/ROS projections are cached in Postgres — use tools, do not invent numbers.",
    "Be decisive: call tools and give a clear recommendation in one reply.",
    "Do not ask follow-up questions or menus. State short assumptions and proceed.",
    "Use get_my_roster for the current lineup (sandbox if the user rearranged Start/Sit), suggest_start_sit for the algorithmic recommendation, evaluate_trade for trades, waiver_targets for FA/waivers.",
    "Use query_players / get_player / compare_players / find_value_plays on the shared rankings board for ADP/ECR/projection analysis; availableOnly means unrostered in this league.",
    "Use web_search only for news/injuries outside cached data.",
    "Cite week/ROS/ADP/ECR numbers from tools. You are read-only — lineup sandbox changes are temporary and not saved to ESPN.",
  ];
  if (workingLineup && workingLineup.length > 0) {
    const lines = workingLineup.map(
      (p) =>
        `${p.slot}: ${p.name} (${p.position}${p.weekProj != null ? `, ${p.weekProj.toFixed(1)} proj` : ""})`,
    );
    parts.push(
      "The user currently has this temporary Start/Sit sandbox arrangement (prefer get_my_roster / this list over ESPN sync when discussing their lineup):",
      lines.join("; "),
    );
  }
  return parts.join(" ");
}

function createAgentForLeague(
  leagueId: string,
  llm: LlmConfig,
  workingLineup?: WorkingLineupEntry[] | null,
) {
  return createAgent({
    model: createChatModel(llm),
    tools: createLeagueTools(leagueId, { workingLineup }),
    systemPrompt: leagueSystemPrompt(leagueId, workingLineup),
  });
}

/** Simple async fan-in queue for parallel message/tool streams. */
function createEventQueue<T>() {
  const buffer: T[] = [];
  const waiters: Array<(item: IteratorResult<T>) => void> = [];
  let closed = false;
  let failure: unknown;

  return {
    push(item: T) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value: item, done: false });
      else buffer.push(item);
    },
    fail(err: unknown) {
      if (closed) return;
      failure = err;
      closed = true;
      while (waiters.length) {
        waiters.shift()!({ value: undefined as T, done: true });
      }
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length) {
        waiters.shift()!({ value: undefined as T, done: true });
      }
    },
    async *iterate(): AsyncGenerator<T> {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (closed) break;
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          waiters.push(resolve);
        });
        if (next.done) break;
        yield next.value;
      }
      if (failure) throw failure;
    },
  };
}

export async function runDraftChatAgent(params: {
  draftId: string;
  messages: ChatTurn[];
  llm: LlmConfig;
}): Promise<AgentRunResult> {
  const agent = createAgentForDraft(params.draftId, params.llm);

  const result = await agent.invoke({
    messages: toLangChainMessages(params.messages),
  });

  const resultMessages = (result.messages ?? []) as BaseMessage[];
  const lastAi = [...resultMessages].reverse().find((m) => AIMessage.isInstance(m));
  const reply = lastAi ? extractText(lastAi.content) : "No response from the model.";
  const toolCalls = enrichToolCalls(resultMessages);

  if (toolCalls.length === 0) {
    return { reply, toolCalls: collectToolCalls(resultMessages) };
  }

  return { reply, toolCalls };
}

/**
 * Stream tokens / reasoning / tool events via LangChain ReactAgent streamEvents v3.
 * Honors AbortSignal for Stop.
 */
export async function* streamDraftChatAgent(params: {
  draftId: string;
  messages: ChatTurn[];
  llm: LlmConfig;
  signal?: AbortSignal;
}): AsyncGenerator<DraftAgentStreamEvent> {
  if (params.signal?.aborted) {
    yield { type: "done", stopped: true };
    return;
  }

  const agent = createAgentForDraft(params.draftId, params.llm);
  const queue = createEventQueue<DraftAgentStreamEvent>();

  const runPromise = (async () => {
    const run = await agent.streamEvents(
      { messages: toLangChainMessages(params.messages) },
      { version: "v3", signal: params.signal },
    );

    const messagePump = (async () => {
      for await (const msg of run.messages) {
        if (params.signal?.aborted) return;

        const reasoningTask = (async () => {
          try {
            for await (const delta of msg.reasoning) {
              if (params.signal?.aborted) return;
              if (delta) queue.push({ type: "reasoning", delta });
            }
          } catch {
            // Some models have no reasoning channel.
          }
        })();

        try {
          for await (const delta of msg.text) {
            if (params.signal?.aborted) return;
            if (delta) queue.push({ type: "token", delta });
          }
        } catch (err) {
          if (!params.signal?.aborted) {
            throw err instanceof Error ? err : new Error(String(err));
          }
        }

        await reasoningTask;
      }
    })();

    const toolPump = (async () => {
      for await (const call of run.toolCalls) {
        if (params.signal?.aborted) return;
        const id = call.callId || `${call.name}-${Date.now()}`;
        queue.push({
          type: "tool_start",
          id,
          name: call.name,
          input: call.input ?? null,
        });
        try {
          const [output, status, error] = await Promise.all([
            call.output.catch(() => undefined),
            call.status.catch(() => "error" as const),
            call.error.catch(() => undefined),
          ]);
          const text =
            toolOutputToString(output, error) ||
            (status === "error" ? "Tool failed" : "");
          queue.push({
            type: "tool_end",
            id,
            name: call.name,
            output: text,
          });
        } catch (err) {
          queue.push({
            type: "tool_end",
            id,
            name: call.name,
            output: err instanceof Error ? err.message : "Tool failed",
          });
        }
      }
    })();

    // Await final state too — otherwise some post-tool model failures only
    // reject run.output and can leave the NDJSON stream hanging until timeout.
    const settled = await Promise.allSettled([messagePump, toolPump, run.output]);
    const firstReject = settled.find((r) => r.status === "rejected");
    if (firstReject && firstReject.status === "rejected") {
      throw firstReject.reason;
    }
  })();

  const finished = runPromise
    .then(() => {
      queue.push({ type: "done", stopped: Boolean(params.signal?.aborted) });
      queue.close();
    })
    .catch((err) => {
      if (params.signal?.aborted) {
        queue.push({ type: "done", stopped: true });
        queue.close();
        return;
      }
      const message = err instanceof Error ? err.message : "Agent failed";
      console.error("[draft-agent] stream failed:", message);
      queue.push({ type: "error", message });
      queue.push({ type: "done" });
      queue.close();
    });

  try {
    for await (const event of queue.iterate()) {
      yield event;
    }
  } finally {
    await finished;
  }
}

export async function* streamLeagueChatAgent(params: {
  leagueId: string;
  messages: ChatTurn[];
  llm: LlmConfig;
  signal?: AbortSignal;
  workingLineup?: WorkingLineupEntry[] | null;
}): AsyncGenerator<DraftAgentStreamEvent> {
  if (params.signal?.aborted) {
    yield { type: "done", stopped: true };
    return;
  }

  const agent = createAgentForLeague(params.leagueId, params.llm, params.workingLineup);
  const queue = createEventQueue<DraftAgentStreamEvent>();

  const runPromise = (async () => {
    const run = await agent.streamEvents(
      { messages: toLangChainMessages(params.messages) },
      { version: "v3", signal: params.signal },
    );

    const messagePump = (async () => {
      for await (const msg of run.messages) {
        if (params.signal?.aborted) return;

        const reasoningTask = (async () => {
          try {
            for await (const delta of msg.reasoning) {
              if (params.signal?.aborted) return;
              if (delta) queue.push({ type: "reasoning", delta });
            }
          } catch {
            // Some models have no reasoning channel.
          }
        })();

        try {
          for await (const delta of msg.text) {
            if (params.signal?.aborted) return;
            if (delta) queue.push({ type: "token", delta });
          }
        } catch (err) {
          if (!params.signal?.aborted) {
            throw err instanceof Error ? err : new Error(String(err));
          }
        }

        await reasoningTask;
      }
    })();

    const toolPump = (async () => {
      for await (const call of run.toolCalls) {
        if (params.signal?.aborted) return;
        const id = call.callId || `${call.name}-${Date.now()}`;
        queue.push({
          type: "tool_start",
          id,
          name: call.name,
          input: call.input ?? null,
        });
        try {
          const [output, status, error] = await Promise.all([
            call.output.catch(() => undefined),
            call.status.catch(() => "error" as const),
            call.error.catch(() => undefined),
          ]);
          const text =
            toolOutputToString(output, error) ||
            (status === "error" ? "Tool failed" : "");
          queue.push({
            type: "tool_end",
            id,
            name: call.name,
            output: text,
          });
        } catch (err) {
          queue.push({
            type: "tool_end",
            id,
            name: call.name,
            output: err instanceof Error ? err.message : "Tool failed",
          });
        }
      }
    })();

    const settled = await Promise.allSettled([messagePump, toolPump, run.output]);
    const firstReject = settled.find((r) => r.status === "rejected");
    if (firstReject && firstReject.status === "rejected") {
      throw firstReject.reason;
    }
  })();

  const finished = runPromise
    .then(() => {
      queue.push({ type: "done", stopped: Boolean(params.signal?.aborted) });
      queue.close();
    })
    .catch((err) => {
      if (params.signal?.aborted) {
        queue.push({ type: "done", stopped: true });
        queue.close();
        return;
      }
      const message = err instanceof Error ? err.message : "Agent failed";
      console.error("[league-agent] stream failed:", message);
      queue.push({ type: "error", message });
      queue.push({ type: "done" });
      queue.close();
    });

  try {
    for await (const event of queue.iterate()) {
      yield event;
    }
  } finally {
    await finished;
  }
}
