import Anthropic from "@anthropic-ai/sdk";
import type { LLMEvent, LLMMessage, LLMOptions } from "../types.js";
import type { LLMProvider } from "../provider.js";
import { isAdaptiveClaudeModel } from "../../catalog.js";

const DEFAULT_MAX_TOKENS = 4096;

export function buildAnthropicRequest(providerId: string, messages: LLMMessage[], options: LLMOptions): Anthropic.MessageCreateParamsStreaming {
  const system: string[] = [];
  const converted: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "system") { system.push(message.content); continue; }
    const text = message.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("");
    converted.push({ role: message.role === "assistant" ? "assistant" : "user", content: text });
  }
  const body: Anthropic.MessageCreateParamsStreaming = {
    model: options.model,
    max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
    messages: converted,
    stream: true,
  };
  if (system.length) body.system = system.join("\n");
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.top_p !== undefined) body.top_p = options.top_p;
  // Only the native Anthropic provider gets Claude adaptive controls. Kimi For
  // Coding and MiniMax share the wire protocol but do not document these fields.
  if (providerId === "anthropic" && isAdaptiveClaudeModel(options.model) && options.thinking?.enabled) {
    body.thinking = { type: "adaptive" };
    if (options.thinking.effort) {
      (body as unknown as Record<string, unknown>).output_config = { effort: options.thinking.effort };
    }
  }
  return body;
}

export class AnthropicAdapter implements LLMProvider {
  constructor(private readonly client: Anthropic, private readonly providerId: string) {}

  async *stream(request: { messages: LLMMessage[]; options: LLMOptions; signal?: AbortSignal }): AsyncIterable<LLMEvent> {
    const body = buildAnthropicRequest(this.providerId, request.messages, request.options);
    try {
      const stream = await this.client.messages.create(body, { signal: request.signal });
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") yield { type: "content", part: { type: "text", text: event.delta.text } };
          else if (event.delta.type === "thinking_delta") yield { type: "content", part: { type: "think", think: event.delta.thinking } };
        } else if (event.type === "message_delta") {
          if (event.usage) yield { type: "status", usage: { input: event.usage.input_tokens ?? 0, output: event.usage.output_tokens ?? 0, cacheRead: event.usage.cache_read_input_tokens ?? undefined, cacheCreation: event.usage.cache_creation_input_tokens ?? undefined } };
          if (event.delta.stop_reason) yield { type: "done", finishReason: event.delta.stop_reason };
        } else if (event.type === "message_stop") yield { type: "done" };
      }
    } catch (error) {
      yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) };
      yield { type: "done" };
    }
  }
}
