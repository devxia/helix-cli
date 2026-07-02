import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import type { ProviderConfig } from "../config.js";
import type { LLMProvider } from "./provider.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { GoogleGenAIAdapter } from "./adapters/google-genai.js";

export function createLLMProvider(
  providerId: string,
  provider: ProviderConfig,
  apiKey: string,
  baseURL: string,
): LLMProvider {
  switch (provider.type) {
    case "anthropic": {
      const client = new Anthropic({
        apiKey: apiKey || "unset",
        baseURL: baseURL || undefined,
      });
      return new AnthropicAdapter(client);
    }
    case "google-genai":
    case "vertexai": {
      const client = new GoogleGenAI({
        apiKey: apiKey || "unset",
        ...(provider.type === "vertexai" && {
          vertexai: true,
          project: process.env.GOOGLE_VERTEX_PROJECT,
          location: process.env.GOOGLE_VERTEX_LOCATION,
        }),
      });
      return new GoogleGenAIAdapter(client);
    }
    case "kimi":
    case "openai":
    case "openai_responses":
    default: {
      const client = new OpenAI({
        apiKey: apiKey || "unset",
        baseURL,
        defaultHeaders: { "User-Agent": resolveUserAgent(providerId) },
      });
      return new OpenAIAdapter(client, resolveUserAgent(providerId));
    }
  }
}

function resolveUserAgent(providerId: string): string {
  if (providerId === "kimi-code") return "KimiCLI/0.63";
  return "HelixCLI/1.5";
}
