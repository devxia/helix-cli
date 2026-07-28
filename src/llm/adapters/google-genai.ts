import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig } from "@google/genai";
import type { LLMEvent, LLMMessage, LLMOptions } from "../types.js";
import type { LLMProvider } from "../provider.js";

export function toGenaiContents(messages: LLMMessage[]): { systemInstruction?: string; contents: Content[] } {
  const system: string[] = [];
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === "system") { system.push(message.content); continue; }
    const parts = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => ({ text: part.text }));
    contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }
  return { systemInstruction: system.length ? system.join("\n") : undefined, contents };
}

export function buildGoogleConfig(messages: LLMMessage[], options: LLMOptions, signal?: AbortSignal): GenerateContentConfig {
  const { systemInstruction } = toGenaiContents(messages);
  const config: GenerateContentConfig = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (options.temperature !== undefined) config.temperature = options.temperature;
  if (options.top_p !== undefined) config.topP = options.top_p;
  if (options.max_tokens !== undefined) config.maxOutputTokens = options.max_tokens;
  if (signal) config.abortSignal = signal;
  if (options.thinking) {
    if (!options.thinking.enabled) config.thinkingConfig = { includeThoughts: false, thinkingBudget: 0 };
    else if (!options.thinking.effort) config.thinkingConfig = { includeThoughts: true };
    else {
      const levels: Record<string, ThinkingLevel> = {
        minimal: ThinkingLevel.MINIMAL,
        low: ThinkingLevel.LOW,
        medium: ThinkingLevel.MEDIUM,
        high: ThinkingLevel.HIGH,
      };
      const level = levels[options.thinking.effort];
      config.thinkingConfig = level ? { includeThoughts: true, thinkingLevel: level } : { includeThoughts: true };
    }
  }
  return config;
}

export class GoogleGenAIAdapter implements LLMProvider {
  constructor(private readonly client: GoogleGenAI) {}

  async *stream(request: { messages: LLMMessage[]; options: LLMOptions; signal?: AbortSignal }): AsyncIterable<LLMEvent> {
    const { contents } = toGenaiContents(request.messages);
    const config = buildGoogleConfig(request.messages, request.options, request.signal);
    try {
      const stream = await this.client.models.generateContentStream({ model: request.options.model, contents, config });
      for await (const response of stream) {
        const usage = response.usageMetadata;
        if (usage) yield { type: "status", usage: { input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0, cacheRead: usage.cacheTokensDetails?.reduce((sum, item) => sum + (item.tokenCount ?? 0), 0) } };
        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
          if (part.thought && part.text) yield { type: "content", part: { type: "think", think: part.text } };
          else if (part.text) yield { type: "content", part: { type: "text", text: part.text } };
        }
        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason) yield { type: "done", finishReason };
      }
    } catch (error) {
      yield { type: "error", error: error instanceof Error ? error : new Error(String(error)) };
      yield { type: "done" };
    }
  }
}
