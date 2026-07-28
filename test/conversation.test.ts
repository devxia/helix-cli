import { describe, expect, test } from "bun:test";
import { buildConversation, estimateTokens, type ConversationLogItem } from "../src/tui/conversation.js";

const EXACT_SYSTEM_PROMPT = `You are Helix, an AI assistant for scientific and bioinformatics work.
Help users analyze biological questions and workflows from the terminal.
Answer directly in the user's language.
Do not claim tool access unless explicitly provided.`;

describe("conversation boundary", () => {
  test("starts with exact hidden prompt, ends with latest user, and excludes notices/pending/failed empty", () => {
    const log: ConversationLogItem[] = [
      { role: "notice", content: "Ready /provider [stopped]" },
      { role: "user", content: "old orphan" },
      { role: "assistant", content: "", state: "failed" },
      { role: "user", content: "prior" },
      { role: "assistant", content: "reply", state: "complete" },
      { role: "user", content: "pending pair user" },
      { role: "assistant", content: "", state: "pending" },
      { role: "user", content: "latest" },
    ];
    const result = buildConversation(log, { contextLimit: 8000, thinkingPersistence: "none" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages[0]).toEqual({ role: "system", content: EXACT_SYSTEM_PROMPT });
    expect(result.messages.at(-1)).toEqual({ role: "user", content: [{ type: "text", text: "latest" }] });
    const serialized = JSON.stringify(result.messages);
    expect(serialized).not.toContain("Ready");
    expect(serialized).not.toContain("old orphan");
    expect(serialized).not.toContain("pending pair user");
    for (const message of result.messages) {
      if (message.role === "assistant") expect(message.content.length).toBeGreaterThan(0);
    }
  });

  test("stopped partial is preserved without marker; historical Thinking is required-only", () => {
    const log: ConversationLogItem[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: "partial", thinking: "thought", state: "stopped" },
      { role: "user", content: "two" },
    ];
    const optional = buildConversation(log, { contextLimit: 8000, thinkingPersistence: "optional" });
    const required = buildConversation(log, { contextLimit: 8000, thinkingPersistence: "required" });
    expect(optional.ok && JSON.stringify(optional.messages)).not.toContain("thought");
    expect(required.ok && JSON.stringify(required.messages)).toContain("thought");
    expect(required.ok && JSON.stringify(required.messages)).not.toContain("stopped");
  });

  test("Thinking-only stopped turn is UI-only when replay is not required", () => {
    const log: ConversationLogItem[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: "", thinking: "only thought", state: "stopped" },
      { role: "user", content: "two" },
    ];
    const result = buildConversation(log, { contextLimit: 8000, thinkingPersistence: "none" });
    expect(result.ok && JSON.stringify(result.messages)).not.toContain("one");
    expect(result.ok && JSON.stringify(result.messages)).not.toContain("only thought");
  });

  test("estimator is deterministic for ASCII and non-ASCII", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("abcde中🙂")).toBe(4);
  });

  test("evicts oldest whole turns and never truncates messages", () => {
    const old = "a".repeat(200);
    const recent = "b".repeat(40);
    const log: ConversationLogItem[] = [
      { role: "user", content: old }, { role: "assistant", content: old, state: "complete" },
      { role: "user", content: recent }, { role: "assistant", content: recent, state: "complete" },
      { role: "user", content: "latest" },
    ];
    const result = buildConversation(log, { contextLimit: 160, thinkingPersistence: "none" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = JSON.stringify(result.messages);
    expect(data).not.toContain(old);
    expect(data).toContain(recent);
    expect(data).toContain("latest");
  });

  test("locally rejects an oversized latest input using 8K fallback", () => {
    const result = buildConversation([{ role: "user", content: "x".repeat(40_000) }], { thinkingPersistence: "none" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("too large");
  });
});
