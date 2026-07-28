import OpenAI from "openai";
import type { LLMEvent, LLMMessage, LLMOptions } from "../types.js";
import type { LLMProvider } from "../provider.js";
import { moonshotReasoningMode } from "../../catalog.js";

interface OpenAIDelta { content?: string | null; reasoning_content?: string | null; }

export function toOpenAIMessages(messages: LLMMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "system") return { role: "system", content: message.content };
    if (message.role === "user") {
      return { role: "user", content: message.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => ({ type: "text" as const, text: part.text })) };
    }
    const text = message.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("");
    const thinking = message.content.filter((part): part is { type: "think"; think: string } => part.type === "think").map((part) => part.think).join("");
    const result: Record<string, unknown> = { role: "assistant", content: text };
    if (thinking) result.reasoning_content = thinking;
    return result as unknown as OpenAI.Chat.ChatCompletionAssistantMessageParam;
  });
}

export function buildOpenAIRequest(providerId: string, messages: LLMMessage[], options: LLMOptions): OpenAI.Chat.ChatCompletionCreateParamsStreaming {
  const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
    model: options.model,
    messages: toOpenAIMessages(messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.top_p !== undefined) body.top_p = options.top_p;
  if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
  const thinking = options.thinking;
  if (thinking) {
    const wire = body as unknown as Record<string, unknown>;
    if (providerId === "moonshotai" || providerId === "moonshotai-cn") {
      const mode = moonshotReasoningMode(options.model);
      if (mode === "toggle") wire.thinking = { type: thinking.enabled ? "enabled" : "disabled" };
      if (mode === "k3" && thinking.enabled && thinking.effort) wire.reasoning_effort = thinking.effort;
    } else if (thinking.enabled && thinking.effort) {
      wire.reasoning_effort = thinking.effort;
    }
  }
  return body;
}

export class OpenAIAdapter implements LLMProvider {
  constructor(private readonly client: OpenAI, private readonly providerId: string, private readonly userAgent?: string) {}

  async *stream(request: { messages: LLMMessage[]; options: LLMOptions; signal?: AbortSignal }): AsyncIterable<LLMEvent> {
    const body = buildOpenAIRequest(this.providerId, request.messages, request.options);
    try {
      const stream = await this.client.chat.completions.create(body, {
        signal: request.signal,
        headers: this.userAgent ? { "User-Agent": this.userAgent } : undefined,
      });
      for await (const chunk of stream) {
        const usage = (chunk as { usage?: OpenAI.CompletionUsage }).usage;
        if (usage) yield { type: "status", usage: { input: usage.prompt_tokens, output: usage.completion_tokens, cacheRead: usage.prompt_tokens_details?.cached_tokens } };
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta as OpenAIDelta;
        if (delta.reasoning_content) yield { type: "content", part: { type: "think", think: delta.reasoning_content } };
        if (delta.content) yield { type: "content", part: { type: "text", text: delta.content } };
        if (choice.finish_reason) yield { type: "done", finishReason: choice.finish_reason };
      }
    } catch (error) {
      yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) };
      yield { type: "done" };
    }
  }
}
