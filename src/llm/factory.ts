import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import type { ProviderConfig, ResolvedCredentials } from "../config.js";
import type { LLMProvider } from "./provider.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { GoogleGenAIAdapter } from "./adapters/google-genai.js";

export function googleClientOptions(provider: ProviderConfig, credentials: ResolvedCredentials): GoogleGenAIOptions {
  if (provider.type === "vertexai") {
    if (credentials.kind !== "vertex") throw new Error("Vertex requires GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_LOCATION");
    return { vertexai: true, project: credentials.project, location: credentials.location };
  }
  if (credentials.kind !== "api-key") throw new Error("Google GenAI requires an API key");
  return { apiKey: credentials.apiKey };
}

export function createLLMProvider(providerId: string, provider: ProviderConfig, credentials: ResolvedCredentials): LLMProvider {
  switch (provider.type) {
    case "anthropic": {
      const apiKey = credentials.kind === "api-key" ? credentials.apiKey : "";
      return new AnthropicAdapter(new Anthropic({ apiKey, baseURL: provider.base_url || undefined }), providerId);
    }
    case "google-genai":
    case "vertexai":
      return new GoogleGenAIAdapter(new GoogleGenAI(googleClientOptions(provider, credentials)));
    case "openai": {
      const apiKey = credentials.kind === "api-key" ? credentials.apiKey : "";
      const userAgent = providerId === "kimi-for-coding" ? "KimiCLI/0.63" : "HelixCLI/1.5";
      const client = new OpenAI({ apiKey, baseURL: provider.base_url, defaultHeaders: { "User-Agent": userAgent } });
      return new OpenAIAdapter(client, providerId, userAgent);
    }
  }
}
