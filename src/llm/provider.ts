import type { LLMEvent, LLMMessage, LLMOptions, LLMTool } from "./types.js";

export interface LLMProvider {
  /**
   * Stream an LLM request.
   *
   * The returned async iterable yields unified {@link LLMEvent} chunks.
   * The adapter is responsible for mapping provider-specific wire formats
   * into this common event stream.
   */
  stream(request: {
    messages: LLMMessage[];
    tools?: LLMTool[];
    options: LLMOptions;
  }): AsyncIterable<LLMEvent>;
}
