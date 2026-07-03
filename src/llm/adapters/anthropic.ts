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

    let maxTokens = options.max_tokens ?? DEFAULT_MAX_TOKENS;
    if (options.thinking) {
      maxTokens = Math.max(maxTokens, DEFAULT_THINKING_BUDGET + 1);
    }

    const body: Anthropic.MessageCreateParams = {
      model: options.model,
      max_tokens: maxTokens,
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
      case "assistant": {
        const textContent = message.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");

        // Preserve tool_use blocks from previous turns so the Anthropic API
        // can maintain tool-call context across multi-turn conversations.
        if (message.tool_calls && message.tool_calls.length > 0) {
          const blocks: Anthropic.Messages.ContentBlockParam[] = [];
          if (textContent) {
            blocks.push({ type: "text", text: textContent });
          }
          for (const tc of message.tool_calls) {
            let input: unknown = {};
            try {
              input = JSON.parse(tc.function.arguments);
            } catch {
              // Use empty object if arguments are not valid JSON.
            }
            blocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input,
            });
          }
          return { role: "assistant", content: blocks };
        }

        return {
          role: "assistant",
          content: textContent,
        };
      }
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
