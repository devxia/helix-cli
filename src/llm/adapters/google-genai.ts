import { GoogleGenAI, type Content, type Part, type GenerateContentResponse } from "@google/genai";
import type { LLMEvent, LLMMessage, LLMOptions, LLMTool } from "../types.js";
import type { LLMProvider } from "../provider.js";

export class GoogleGenAIAdapter implements LLMProvider {
  constructor(private readonly client: GoogleGenAI) {}

  async *stream(request: {
    messages: LLMMessage[];
    tools?: LLMTool[];
    options: LLMOptions;
    signal?: AbortSignal;
  }): AsyncIterable<LLMEvent> {
    const { messages, tools, options } = request;
    const { systemInstruction, contents } = this.toGenaiContents(messages);

    const config: Record<string, unknown> = {};
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (options.temperature !== undefined) config.temperature = options.temperature;
    if (options.top_p !== undefined) config.topP = options.top_p;
    if (options.max_tokens !== undefined) config.maxOutputTokens = options.max_tokens;
    if (options.thinking) {
      config.thinkingConfig = { includeThoughts: true };
    }
    if (tools && tools.length > 0) {
      config.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    const toolBuffers = new Map<string, { id: string; name: string; arguments: string }>();

    try {
      // TODO: @google/genai v2.8.0 does not expose a per-request AbortSignal;
      // once the SDK supports it, thread request.signal through here.
      const stream = await this.client.models.generateContentStream({
        model: options.model,
        contents,
        config,
      });

      for await (const response of stream) {
        const usage = response.usageMetadata;
        if (usage) {
          yield {
            type: "status",
            usage: {
              input: usage.promptTokenCount ?? 0,
              output: usage.candidatesTokenCount ?? 0,
              cacheRead: usage.cacheTokensDetails?.reduce((sum, d) => sum + (d.tokenCount ?? 0), 0),
            },
          };
        }

        const parts = response.candidates?.[0]?.content?.parts;
        if (!parts) continue;

        for (const part of parts) {
          yield* this.handlePart(part, toolBuffers);
        }

        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason) {
          yield { type: "done", finishReason };
        }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err : new Error(String(err)) };
      yield { type: "done" };
    }
  }

  private *handlePart(
    part: Part,
    toolBuffers: Map<string, { id: string; name: string; arguments: string }>,
  ): Generator<LLMEvent> {
    if (part.thought && part.text) {
      yield { type: "content", part: { type: "think", think: part.text } };
      return;
    }

    if (part.text) {
      yield { type: "content", part: { type: "text", text: part.text } };
      return;
    }

    if (part.functionCall) {
      const fc = part.functionCall;
      const id = fc.id ?? `${fc.name}-${Date.now()}`;
      const args = fc.args ? JSON.stringify(fc.args) : "";
      toolBuffers.set(id, { id, name: fc.name ?? "", arguments: args });
      // Google GenAI SDK delivers the complete function call in one part, but we
      // still emit the standard tool_call + tool_call_part sequence so consumers
      // can treat all adapters uniformly.
      yield {
        type: "tool_call",
        tool_call: { type: "function", id, function: { name: fc.name ?? "", arguments: "" } },
      };
      if (args) {
        yield {
          type: "tool_call_part",
          tool_call_id: id,
          arguments_part: args,
        };
      }
    }
  }

  private toGenaiContents(messages: LLMMessage[]): {
    systemInstruction?: string;
    contents: Content[];
  } {
    const systemParts: string[] = [];
    const contents: Content[] = [];
    const toolNameMap = new Map<string, string>();

    for (const m of messages) {
      if (m.role === "system") {
        systemParts.push(m.content);
        continue;
      }
      if (m.role === "assistant" && m.tool_calls) {
        for (const tc of m.tool_calls) {
          toolNameMap.set(tc.id, tc.function.name);
        }
      }
      contents.push(this.toGenaiContent(m, toolNameMap));
    }

    return {
      systemInstruction: systemParts.length > 0 ? systemParts.join("\n") : undefined,
      contents,
    };
  }

  private toGenaiContent(
    message: LLMMessage,
    toolNameMap: Map<string, string>,
  ): Content {
    switch (message.role) {
      case "user":
        return {
          role: "user",
          parts: message.content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => ({ text: p.text })),
        };
      case "assistant": {
        const parts: Part[] = message.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => ({ text: p.text }));

        if (message.tool_calls) {
          for (const tc of message.tool_calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              // Leave args empty if the model emitted invalid JSON.
            }
            parts.push({
              functionCall: {
                id: tc.id,
                name: tc.function.name,
                args,
              },
            });
          }
        }
        return { role: "model", parts };
      }
      case "tool":
        return {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: message.tool_call_id,
                name: toolNameMap.get(message.tool_call_id) ?? "",
                response: { result: message.content },
              },
            },
          ],
        };
      default:
        throw new Error(`Unsupported message role for Google GenAI: ${(message as { role: string }).role}`);
    }
  }
}
