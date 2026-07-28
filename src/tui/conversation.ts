import type { LLMMessage } from "../llm/types.js";
import type { ThinkingPersistence } from "../config.js";

export const HELIX_SYSTEM_PROMPT = `You are Helix, an AI assistant for scientific and bioinformatics work.
Help users analyze biological questions and workflows from the terminal.
Answer directly in the user's language.
Do not claim tool access unless explicitly provided.`;

export type ConversationLogItem =
  | { role: "notice"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; thinking?: string; state: "pending" | "complete" | "stopped" | "failed" };

export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of text) {
    if (character.codePointAt(0)! < 128) ascii += character.length;
    else nonAscii++;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

function messageTokens(message: LLMMessage): number {
  if (message.role === "system") return estimateTokens(message.content);
  return message.content.reduce((sum, part) => sum + estimateTokens(part.type === "text" ? part.text : part.think), 0);
}

function assistantMessage(item: Extract<ConversationLogItem, { role: "assistant" }>, persistence: ThinkingPersistence): LLMMessage | null {
  if (item.state !== "complete" && item.state !== "stopped") return null;
  const content: Extract<LLMMessage, { role: "assistant" }>["content"] = [];
  if (persistence === "required" && item.thinking) content.push({ type: "think", think: item.thinking });
  if (item.content) content.push({ type: "text", text: item.content });
  return content.length ? { role: "assistant", content } : null;
}

export type ConversationBuildResult =
  | { ok: true; messages: LLMMessage[]; estimatedTokens: number; budget: number }
  | { ok: false; error: string; budget: number };

export interface RequestSettlement {
  state: "complete" | "stopped" | "failed";
  removeAssistant: boolean;
  clearConversation: boolean;
  showError: boolean;
  status: "Idle" | "Stopped" | "Chat cleared";
}

export function settleOwnedRequest<T>(
  activeOwner: T | null,
  owner: T,
  input: { aborted: boolean; hasOutput: boolean; hasError: boolean; pendingClear: boolean },
): RequestSettlement | null {
  if (activeOwner !== owner) return null;
  const state = input.aborted ? "stopped" : input.hasError || !input.hasOutput ? "failed" : "complete";
  return {
    state,
    removeAssistant: !input.hasOutput && state !== "complete",
    clearConversation: input.pendingClear,
    showError: input.hasError && !input.aborted,
    status: input.pendingClear ? "Chat cleared" : input.aborted ? "Stopped" : "Idle",
  };
}

export function buildConversation(
  log: ConversationLogItem[],
  options: { contextLimit?: number; thinkingPersistence: ThinkingPersistence },
): ConversationBuildResult {
  const contextLimit = options.contextLimit && options.contextLimit > 0 ? options.contextLimit : 8_000;
  const budget = Math.floor(contextLimit * 0.8);
  let latestUserIndex = -1;
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index]?.role === "user") { latestUserIndex = index; break; }
  }
  if (latestUserIndex < 0) return { ok: false, error: "No user message to send.", budget };
  const latest = log[latestUserIndex] as Extract<ConversationLogItem, { role: "user" }>;
  const system: LLMMessage = { role: "system", content: HELIX_SYSTEM_PROMPT };
  const current: LLMMessage = { role: "user", content: [{ type: "text", text: latest.content }] };
  const required = messageTokens(system) + messageTokens(current);
  if (required > budget) {
    return { ok: false, error: `Input is too large for this model's context window (${required} estimated tokens; ${budget} available).`, budget };
  }

  const turns: Array<[LLMMessage, LLMMessage]> = [];
  let pendingUser: Extract<ConversationLogItem, { role: "user" }> | null = null;
  for (let index = 0; index < latestUserIndex; index++) {
    const item = log[index]!;
    if (item.role === "user") {
      pendingUser = item;
    } else if (item.role === "assistant" && pendingUser) {
      const assistant = assistantMessage(item, options.thinkingPersistence);
      if (assistant) {
        turns.push([{ role: "user", content: [{ type: "text", text: pendingUser.content }] }, assistant]);
        pendingUser = null;
      }
    }
  }

  let total = required;
  const included: Array<[LLMMessage, LLMMessage]> = [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!;
    const size = messageTokens(turn[0]) + messageTokens(turn[1]);
    if (total + size > budget) break;
    total += size;
    included.unshift(turn);
  }
  return { ok: true, messages: [system, ...included.flat(), current], estimatedTokens: total, budget };
}
