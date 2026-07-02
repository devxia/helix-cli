import Anthropic from "@anthropic-ai/sdk";
import type { LLMEvent, LLMMessage, LLMOptions, LLMTool } from "../types.js";
import type { LLMProvider } from "../provider.js";

const DEFAULT_THINKING_BUDGET = 10000;
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicAdapter implements LLMProvider {
  constructor(private readonly client: Anthropic) {}

  async *stream(request: {
    messages: LLMMessage[];
    tools?: LLMTool[];
    options: LLMOptions;
    signal?: AbortSignal;
  }): AsyncIterable<LLMEvent> {
    const { messages, tools, options } = request;

    const { system, anthropicMessages } = this.splitSystem(messages);

    const body: Anthropic.MessageCreateParams = {
      model: options.model,
      max_tokens: options.max_tokens ?? DEFAULT_MAX_TOKENS,
      messages: anthropicMessages,
      stream: true,
    };
    let nextToolIndex = 0;

    if (system) body.system = system;

    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.top_p !== undefined) body.top_p = options.top_p;
    if (options.thinking) {
      body.thinking = {
        type: "enabled",
        budget_tokens: DEFAULT_THINKING_BUDGET,
      };
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
      }));
    }

    try {
      const stream = await this.client.messages.create(body as Anthropic.MessageCreateParamsStreaming, {
        signal: request.signal,
      });

      const toolBuffers = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const event of stream) {
        switch (event.type) {
          case "content_block_start":
            if (event.content_block.type === "tool_use") {
              const tb = event.content_block;
              const index = nextToolIndex++;
              toolBuffers.set(index, {
                id: tb.id,
                name: tb.name,
                arguments: "",
              });
              yield {
                type: "tool_call",
                tool_call: { type: "function", id: tb.id, function: { name: tb.name, arguments: "" } },
              };
            }
            break;

          case "content_block_delta":
            if (event.delta.type === "text_delta") {
              yield { type: "content", part: { type: "text", text: event.delta.text } };
            } else if (event.delta.type === "thinking_delta") {
              yield { type: "content", part: { type: "think", think: event.delta.thinking } };
            } else if (event.delta.type === "input_json_delta") {
              const buffer = toolBuffers.get(event.index);
              if (buffer) {
                buffer.arguments += event.delta.partial_json;
                yield {
                  type: "tool_call_part",
                  tool_call_id: buffer.id,
                  arguments_part: event.delta.partial_json,
                };
              }
            }
            break;

          case "message_delta":
            if (event.usage) {
              yield {
                type: "status",
                usage: {
                  input: event.usage.input_tokens ?? 0,
                  output: event.usage.output_tokens ?? 0,
                  cacheRead: event.usage.cache_read_input_tokens ?? undefined,
                  cacheCreation: event.usage.cache_creation_input_tokens ?? undefined,
                },
              };
            }
            if (event.delta.stop_reason) {
              yield { type: "done", finishReason: event.delta.stop_reason };
            }
            break;

          case "message_stop":
            yield { type: "done" };
            break;
        }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err : new Error(String(err)) };
      yield { type: "done" };
    }
  }

  private splitSystem(messages: LLMMessage[]): {
    system?: string;
    anthropicMessages: Anthropic.MessageParam[];
  } {
    const systemParts: string[] = [];
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        systemParts.push(m.content);
        continue;
      }
      anthropicMessages.push(this.toAnthropicMessage(m));
    }

    return {
      system: systemParts.length > 0 ? systemParts.join("\n") : undefined,
      anthropicMessages,
    };
  }

  private toAnthropicMessage(message: LLMMessage): Anthropic.MessageParam {
    switch (message.role) {
      case "user":
        return {
          role: "user",
          content: message.content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join(""),
        };
      case "assistant":
        return {
          role: "assistant",
          content: message.content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join(""),
        };
      case "tool":
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: message.tool_call_id,
              content: message.content,
            },
          ],
        };
      default:
        throw new Error(`Unsupported message role for Anthropic: ${(message as { role: string }).role}`);
    }
  }
}
