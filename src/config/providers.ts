/**
 * Static provider and model definitions.
 *
 * Extracted from config.ts to keep the config logic focused on
 * read/write/cache mechanics.
 */

import type { ModelDef } from "../config.js";

// ---------------------------------------------------------------------------
// Fallback models — used when disk cache and API are both unavailable
// ---------------------------------------------------------------------------

export const FALLBACK_MODELS: Record<string, ModelDef[]> = {
  kimi: [
    { id: "kimi-k2", label: "Kimi K2", description: "Latest, thinking-aware", reasoning: true },
    { id: "kimi-for-coding", label: "Kimi for Coding", description: "Code-optimized", reasoning: true },
    { id: "moonshot-v1-8k", label: "Moonshot v1 8K" },
    { id: "moonshot-v1-32k", label: "Moonshot v1 32K" },
    { id: "moonshot-v1-128k", label: "Moonshot v1 128K" },
  ],
  "moonshot-ai": [
    { id: "kimi-k2", label: "Kimi K2", description: "Latest, thinking-aware", reasoning: true },
    { id: "kimi-for-coding", label: "Kimi for Coding", description: "Code-optimized", reasoning: true },
  ],
  "kimi-code": [
    { id: "kimi-for-coding", label: "Kimi for Coding", description: "Code-optimized", reasoning: true },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek V3", description: "General purpose" },
    { id: "deepseek-reasoner", label: "DeepSeek R1", description: "Reasoning-focused", reasoning: true },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o", description: "Multimodal flagship" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", description: "Fast and affordable" },
    { id: "o3-mini", label: "o3 Mini", description: "Reasoning-optimized", reasoning: true },
    { id: "o1", label: "o1", description: "Advanced reasoning", reasoning: true },
  ],
  anthropic: [
    { id: "claude-sonnet-4-8", label: "Claude Sonnet 4.8", description: "Balanced", reasoning: true },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", description: "Maximum capability", reasoning: true },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", description: "Fast and lightweight", reasoning: true },
  ],
  "google-genai": [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Advanced reasoning", reasoning: true },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Fast and efficient", reasoning: true },
  ],
  qwen: [
    { id: "qwen3-235b-a22b", label: "Qwen3 235B", description: "MoE flagship", reasoning: true },
    { id: "qwen3-32b", label: "Qwen3 32B", description: "Dense mid-size", reasoning: true },
    { id: "qwen-max", label: "Qwen Max", description: "Cloud flagship" },
    { id: "qwen-plus", label: "Qwen Plus", description: "Balanced" },
    { id: "qwen-turbo", label: "Qwen Turbo", description: "Fast" },
  ],
  siliconflow: [
    { id: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3", description: "Via SiliconFlow" },
    { id: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1", description: "Via SiliconFlow", reasoning: true },
    { id: "Qwen/Qwen3-235B-A22B", label: "Qwen3 235B", description: "Via SiliconFlow", reasoning: true },
  ],
  volcengine: [
    { id: "doubao-1-5-pro-32k", label: "Doubao 1.5 Pro", description: "ByteDance flagship", reasoning: true },
    { id: "doubao-1-5-lite-32k", label: "Doubao 1.5 Lite", description: "Fast", reasoning: true },
  ],
  zhipu: [
    { id: "glm-4-plus", label: "GLM-4 Plus", description: "Flagship", reasoning: true },
    { id: "glm-4-flash", label: "GLM-4 Flash", description: "Free tier" },
  ],
  minimax: [
    { id: "MiniMax-M1", label: "MiniMax M1", description: "Reasoning model", reasoning: true },
    { id: "abab6.5s-chat", label: "ABAB 6.5s", description: "Chat" },
  ],
  yi: [
    { id: "yi-lightning", label: "Yi Lightning", description: "Fast" },
    { id: "yi-large", label: "Yi Large", description: "Flagship" },
  ],
  baichuan: [
    { id: "Baichuan4", label: "Baichuan 4", description: "Flagship" },
    { id: "Baichuan3-Turbo", label: "Baichuan 3 Turbo", description: "Fast" },
  ],
  mistral: [
    { id: "mistral-large", label: "Mistral Large", description: "Flagship" },
    { id: "mistral-small", label: "Mistral Small", description: "Fast and efficient" },
    { id: "codestral", label: "Codestral", description: "Code-optimized" },
  ],
  groq: [
    { id: "llama-3.3-70b", label: "Llama 3.3 70B", description: "Versatile" },
    { id: "mixtral-8x7b", label: "Mixtral 8x7B", description: "Fast MoE" },
  ],
  xai: [
    { id: "grok-2", label: "Grok 2", description: "xAI flagship" },
  ],
  togetherai: [
    { id: "llama-3.3-70b", label: "Llama 3.3 70B", description: "Meta flagship open model" },
    { id: "deepseek-r1", label: "DeepSeek R1", description: "Reasoning", reasoning: true },
  ],
  fireworks: [
    { id: "llama-v3p1-405b", label: "Llama 3.1 405B", description: "Large open model" },
    { id: "deepseek-r1", label: "DeepSeek R1", description: "Reasoning", reasoning: true },
  ],
  openrouter: [
    { id: "openai/gpt-4o", label: "GPT-4o", description: "Via OpenRouter" },
    { id: "anthropic/claude-sonnet-4-8", label: "Claude Sonnet 4.8", description: "Via OpenRouter", reasoning: true },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Via OpenRouter", reasoning: true },
  ],
  perplexity: [
    { id: "sonar", label: "Sonar", description: "Search-augmented" },
    { id: "sonar-pro", label: "Sonar Pro", description: "Advanced search" },
  ],
  cohere: [
    { id: "command-r-plus", label: "Command R+", description: "Enterprise RAG" },
    { id: "command-r", label: "Command R", description: "Efficient RAG" },
  ],
  deepinfra: [
    { id: "llama-3.3-70b", label: "Llama 3.3 70B", description: "Open model" },
    { id: "deepseek-r1", label: "DeepSeek R1", description: "Reasoning", reasoning: true },
  ],
  cerebras: [
    { id: "llama3.3-70b", label: "Llama 3.3 70B", description: "Ultra-fast inference" },
  ],
};

// ---------------------------------------------------------------------------
// Default providers — base_url + type, no secrets
// ---------------------------------------------------------------------------

export interface ProviderDef {
  name: string;
  type: "openai" | "openai_responses" | "anthropic" | "google-genai" | "kimi" | "vertexai";
  base_url: string;
  api_key: string;
}

export const DEFAULT_PROVIDERS: Record<string, ProviderDef> = {
  // ── Kimi / Moonshot ────────────────────────────────────────────
  kimi: {
    name: "Kimi (Moonshot CN)",
    type: "openai",
    base_url: "https://api.moonshot.cn/v1",
    api_key: "",
  },
  "moonshot-ai": {
    name: "Kimi (Moonshot AI)",
    type: "openai",
    base_url: "https://api.moonshot.ai/v1",
    api_key: "",
  },
  "kimi-code": {
    name: "Kimi Code Plan",
    type: "openai",
    base_url: "https://api.kimi.com/coding/v1",
    api_key: "",
  },

  // ── Major AI Labs ──────────────────────────────────────────────
  openai: {
    name: "OpenAI",
    type: "openai",
    base_url: "https://api.openai.com/v1",
    api_key: "",
  },
  anthropic: {
    name: "Anthropic (Claude)",
    type: "anthropic",
    base_url: "https://api.anthropic.com",
    api_key: "",
  },
  "google-genai": {
    name: "Google Gemini",
    type: "google-genai",
    base_url: "https://generativelanguage.googleapis.com",
    api_key: "",
  },

  // ── Chinese AI Platforms ───────────────────────────────────────
  deepseek: {
    name: "DeepSeek",
    type: "openai",
    base_url: "https://api.deepseek.com",
    api_key: "",
  },
  qwen: {
    name: "Qwen (通义千问)",
    type: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
  },
  siliconflow: {
    name: "SiliconFlow (硅基流动)",
    type: "openai",
    base_url: "https://api.siliconflow.cn/v1",
    api_key: "",
  },
  volcengine: {
    name: "Volcengine (火山引擎)",
    type: "openai",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    api_key: "",
  },
  zhipu: {
    name: "Zhipu AI (智谱)",
    type: "openai",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    api_key: "",
  },
  minimax: {
    name: "MiniMax",
    type: "openai",
    base_url: "https://api.minimax.chat/v1",
    api_key: "",
  },
  yi: {
    name: "Yi (零一万物)",
    type: "openai",
    base_url: "https://api.lingyiwanwu.com/v1",
    api_key: "",
  },
  baichuan: {
    name: "Baichuan (百川)",
    type: "openai",
    base_url: "https://api.baichuan-ai.com/v1",
    api_key: "",
  },

  // ── International Providers ────────────────────────────────────
  mistral: {
    name: "Mistral AI",
    type: "openai",
    base_url: "https://api.mistral.ai/v1",
    api_key: "",
  },
  groq: {
    name: "Groq",
    type: "openai",
    base_url: "https://api.groq.com/openai/v1",
    api_key: "",
  },
  xai: {
    name: "xAI (Grok)",
    type: "openai",
    base_url: "https://api.x.ai/v1",
    api_key: "",
  },
  togetherai: {
    name: "Together AI",
    type: "openai",
    base_url: "https://api.together.xyz/v1",
    api_key: "",
  },
  fireworks: {
    name: "Fireworks AI",
    type: "openai",
    base_url: "https://api.fireworks.ai/inference/v1",
    api_key: "",
  },
  openrouter: {
    name: "OpenRouter",
    type: "openai",
    base_url: "https://openrouter.ai/api/v1",
    api_key: "",
  },
  perplexity: {
    name: "Perplexity",
    type: "openai",
    base_url: "https://api.perplexity.ai",
    api_key: "",
  },
  cohere: {
    name: "Cohere",
    type: "openai",
    base_url: "https://api.cohere.com/v2",
    api_key: "",
  },
  deepinfra: {
    name: "DeepInfra",
    type: "openai",
    base_url: "https://api.deepinfra.com/v1/openai",
    api_key: "",
  },
  cerebras: {
    name: "Cerebras",
    type: "openai",
    base_url: "https://api.cerebras.ai/v1",
    api_key: "",
  },
};

// ---------------------------------------------------------------------------
// Env var mapping per provider
// ---------------------------------------------------------------------------

export const ENV_API_KEY_MAP: Record<string, string> = {
  kimi: "KIMI_API_KEY",
  "moonshot-ai": "MOONSHOT_AI_API_KEY",
  "kimi-code": "KIMI_CODE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "google-genai": "GOOGLE_API_KEY",
  qwen: "QWEN_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  volcengine: "VOLCENGINE_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  minimax: "MINIMAX_API_KEY",
  yi: "YI_API_KEY",
  baichuan: "BAICHUAN_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  togetherai: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  cohere: "COHERE_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
};

export const ENV_BASE_URL_MAP: Record<string, string> = {
  kimi: "KIMI_BASE_URL",
  "moonshot-ai": "MOONSHOT_AI_BASE_URL",
  "kimi-code": "KIMI_CODE_BASE_URL",
  deepseek: "DEEPSEEK_BASE_URL",
  openai: "OPENAI_BASE_URL",
  anthropic: "ANTHROPIC_BASE_URL",
  "google-genai": "GOOGLE_BASE_URL",
  qwen: "QWEN_BASE_URL",
  siliconflow: "SILICONFLOW_BASE_URL",
  volcengine: "VOLCENGINE_BASE_URL",
  zhipu: "ZHIPU_BASE_URL",
  minimax: "MINIMAX_BASE_URL",
  yi: "YI_BASE_URL",
  baichuan: "BAICHUAN_BASE_URL",
  mistral: "MISTRAL_BASE_URL",
  groq: "GROQ_BASE_URL",
  xai: "XAI_BASE_URL",
  togetherai: "TOGETHER_BASE_URL",
  fireworks: "FIREWORKS_BASE_URL",
  openrouter: "OPENROUTER_BASE_URL",
  perplexity: "PERPLEXITY_BASE_URL",
  cohere: "COHERE_BASE_URL",
  deepinfra: "DEEPINFRA_BASE_URL",
  cerebras: "CEREBRAS_BASE_URL",
};

export const ENV_MODEL_MAP: Record<string, string> = {
  kimi: "KIMI_MODEL",
  "moonshot-ai": "KIMI_MODEL",
  "kimi-code": "KIMI_MODEL",
  deepseek: "DEEPSEEK_MODEL",
  openai: "OPENAI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
  "google-genai": "GOOGLE_MODEL",
  vertexai: "GOOGLE_MODEL",
  qwen: "QWEN_MODEL",
  siliconflow: "SILICONFLOW_MODEL",
  volcengine: "VOLCENGINE_MODEL",
  zhipu: "ZHIPU_MODEL",
  minimax: "MINIMAX_MODEL",
  yi: "YI_MODEL",
  baichuan: "BAICHUAN_MODEL",
  mistral: "MISTRAL_MODEL",
  groq: "GROQ_MODEL",
  xai: "XAI_MODEL",
  togetherai: "TOGETHER_MODEL",
  fireworks: "FIREWORKS_MODEL",
  openrouter: "OPENROUTER_MODEL",
  perplexity: "PERPLEXITY_MODEL",
  cohere: "COHERE_MODEL",
  deepinfra: "DEEPINFRA_MODEL",
  cerebras: "CEREBRAS_MODEL",
};
