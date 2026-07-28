import type { LLMEvent, LLMMessage, LLMOptions } from "./types.js";

export interface LLMProvider {
  stream(request: {
    messages: LLMMessage[];
    options: LLMOptions;
    signal?: AbortSignal;
  }): AsyncIterable<LLMEvent>;
}
