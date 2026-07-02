import OpenAI from "openai";
import type { LLMEvent, LLMMessage, LLMOptions, LLMTool } from "../types.js";
import type { LLMProvider } from "../provider.js";

interface OpenAIDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export class OpenAIAdapter implements LLMProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly userAgent?: string,
  ) {}

  async *stream(request: {
    messages: LLMMessage[];
    tools?: LLMTool[];
    options: LLMOptions;
    signal?: AbortSignal;
  }): AsyncIterable<LLMEvent> {
    const { messages, tools, options } = request;

    const body: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: options.model,
      messages: this.toOpenAIMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.top_p !== undefined) body.top_p = options.top_p;
    if (options.max_tokens !== undefined) body.max_tokens = options.max_tokens;
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: t.function,
      }));
    }

    // Some OpenAI-compatible providers support a top-level thinking field.
    // We pass it only when explicitly requested; unknown params are ignored
    // by most servers, but we keep the cast loose to avoid SDK type fights.
    if (options.thinking) {
      (body as unknown as Record<string, unknown>).thinking = { type: "enabled" };
    }

    const headers: Record<string, string> | undefined = this.userAgent
      ? { "User-Agent": this.userAgent }
      : undefined;

    try {
      const stream = await this.client.chat.completions.create(body, {
        signal: request.signal,
        headers,
      });

      const toolCallBuffers = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      for await (const chunk of stream) {
        const usage = (chunk as { usage?: OpenAI.CompletionUsage }).usage;
        if (usage) {
          yield {
            type: "status",
            usage: {
              input: usage.prompt_tokens,
              output: usage.completion_tokens,
              cacheRead: usage.prompt_tokens_details?.cached_tokens,
            },
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta as OpenAIDelta;

        if (delta.reasoning_content) {
          yield { type: "content", part: { type: "think", think: delta.reasoning_content } };
        }

        if (delta.content) {
          yield { type: "content", part: { type: "text", text: delta.content } };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index;
            let buffer = toolCallBuffers.get(index);

            if (!buffer) {
              if (!tc.id || !tc.function?.name) continue;
              buffer = { id: tc.id, name: tc.function.name, arguments: "" };
              toolCallBuffers.set(index, buffer);
              yield {
                type: "tool_call",
                tool_call: { type: "function", id: buffer.id, function: { name: buffer.name, arguments: "" } },
              };
            }

            if (tc.function?.arguments) {
              buffer.arguments += tc.function.arguments;
              yield {
                type: "tool_call_part",
                tool_call_id: buffer.id,
                arguments_part: tc.function.arguments,
              };
            }
          }
        }

        if (choice.finish_reason) {
          yield { type: "done", finishReason: choice.finish_reason };
        }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err : new Error(String(err)) };
      yield { type: "done" };
    }
  }

  private toOpenAIMessages(messages: LLMMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      switch (m.role) {
        case "system":
          return { role: "system", content: m.content };
        case "user":
          return {
            role: "user",
            content: m.content.map((part) => {
              if (part.type === "text") return { type: "text", text: part.text };
              // v1: drop think parts in user messages; OpenAI does not support them.
              return { type: "text", text: "" };
            }),
          };
        case "assistant":
          return {
            role: "assistant",
            content: m.content
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join(""),
            tool_calls: m.tool_calls?.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          };
        case "tool":
          return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
      }
    });
  }
}
