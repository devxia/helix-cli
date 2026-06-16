/**
 * Unified LLM types used by the multi-protocol adapter layer.
 *
 * v1 scope:
 *   - text and thinking content only (no multimodal)
 *   - function-style tool calls
 */

export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "think"; think: string };

export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: LLMContentPart[] }
  | {
      role: "assistant";
      content: LLMContentPart[];
      tool_calls?: LLMToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LLMToolCall {
  type: "function";
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMOptions {
  model: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  thinking?: boolean;
  tools?: LLMTool[];
}

export interface LLMUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
}

export type LLMEvent =
  | { type: "content"; part: LLMContentPart }
  | { type: "tool_call"; tool_call: LLMToolCall }
  | { type: "tool_call_part"; tool_call_id: string; arguments_part: string }
  | { type: "tool_result"; tool_call_id: string; content: string }
  | { type: "status"; usage: LLMUsage }
  | { type: "error"; error: Error }
  | { type: "done"; finishReason?: string };
