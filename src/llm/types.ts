export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "think"; think: string };

export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: LLMContentPart[] }
  | { role: "assistant"; content: LLMContentPart[] };

export interface LLMOptions {
  model: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  thinking?: { enabled: boolean; effort?: string };
}

export interface LLMUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
}

export type LLMEvent =
  | { type: "content"; part: LLMContentPart }
  | { type: "status"; usage: LLMUsage }
  | { type: "error"; error: Error }
  | { type: "done"; finishReason?: string };
