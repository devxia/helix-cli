import { describe, expect, test } from "bun:test";
import { buildOpenAIRequest } from "../src/llm/adapters/openai.js";
import { buildAnthropicRequest } from "../src/llm/adapters/anthropic.js";
import { buildGoogleConfig } from "../src/llm/adapters/google-genai.js";
import type { LLMMessage } from "../src/llm/types.js";

const messages: LLMMessage[] = [
  { role: "system", content: "system" },
  { role: "user", content: [{ type: "text", text: "question" }] },
  { role: "assistant", content: [{ type: "think", think: "historical thought" }, { type: "text", text: "answer" }] },
  { role: "user", content: [{ type: "text", text: "latest" }] },
];

describe("adapter request builders", () => {
  test("OpenAI uses native effort, Moonshot uses its switch, and required history is representable", () => {
    const openai = buildOpenAIRequest("openai", messages, { model: "o3", thinking: { enabled: true, effort: "xhigh" } }) as unknown as Record<string, unknown>;
    expect(openai.reasoning_effort).toBe("xhigh");
    expect(openai.thinking).toBeUndefined();
    expect(JSON.stringify(openai)).not.toContain("tool");
    const assistant = (openai.messages as Array<Record<string, unknown>>)[2];
    expect(assistant?.reasoning_content).toBe("historical thought");

    const k25Off = buildOpenAIRequest("moonshotai-cn", messages, { model: "kimi-k2.5", thinking: { enabled: false } }) as unknown as Record<string, unknown>;
    const k25On = buildOpenAIRequest("moonshotai-cn", messages, { model: "kimi-k2.6", thinking: { enabled: true } }) as unknown as Record<string, unknown>;
    expect(k25Off.thinking).toEqual({ type: "disabled" });
    expect(k25On.thinking).toEqual({ type: "enabled" });

    const k3Auto = buildOpenAIRequest("moonshotai-cn", messages, { model: "kimi-k3", thinking: { enabled: true } }) as unknown as Record<string, unknown>;
    const k3Effort = buildOpenAIRequest("moonshotai-cn", messages, { model: "kimi-k3", thinking: { enabled: true, effort: "max" } }) as unknown as Record<string, unknown>;
    const k27 = buildOpenAIRequest("moonshotai-cn", messages, { model: "kimi-k2.7-code", thinking: { enabled: true } }) as unknown as Record<string, unknown>;
    expect(k3Auto.thinking).toBeUndefined();
    expect(k3Auto.reasoning_effort).toBeUndefined();
    expect(k3Effort.thinking).toBeUndefined();
    expect(k3Effort.reasoning_effort).toBe("max");
    expect(k27.thinking).toBeUndefined();
    expect(k27.reasoning_effort).toBeUndefined();
  });

  test("Anthropic uses adaptive controls without obsolete budget and non-Claude wire providers get no controls", () => {
    const body = buildAnthropicRequest("anthropic", messages, { model: "claude-opus-4-6", thinking: { enabled: true, effort: "max" } }) as unknown as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "max" });
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(JSON.stringify(body)).not.toContain("tool");
    const claude45 = buildAnthropicRequest("anthropic", messages, { model: "claude-haiku-4-5", thinking: { enabled: true, effort: "high" } }) as unknown as Record<string, unknown>;
    expect(claude45.thinking).toBeUndefined();
    expect(claude45.output_config).toBeUndefined();
    const kimi = buildAnthropicRequest("kimi-for-coding", messages, { model: "k3", thinking: { enabled: true, effort: "max" } }) as unknown as Record<string, unknown>;
    expect(kimi.thinking).toBeUndefined();
    expect(kimi.output_config).toBeUndefined();
  });

  test("Google maps native levels without heuristic budgets and receives AbortSignal", () => {
    const controller = new AbortController();
    const auto = buildGoogleConfig(messages, { model: "gemini", thinking: { enabled: true } }, controller.signal);
    expect(auto.thinkingConfig).toEqual({ includeThoughts: true });
    expect(auto.abortSignal).toBe(controller.signal);
    const high = buildGoogleConfig(messages, { model: "gemini", thinking: { enabled: true, effort: "high" } });
    expect(high.thinkingConfig).toEqual({ includeThoughts: true, thinkingLevel: "HIGH" });
    const off = buildGoogleConfig(messages, { model: "gemini", thinking: { enabled: false } });
    expect(off.thinkingConfig).toEqual({ includeThoughts: false, thinkingBudget: 0 });
    expect(JSON.stringify(high)).not.toContain("tools");
  });
});
