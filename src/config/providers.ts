import type { ModelDef, ProviderType } from "../config.js";

const NONE = { availability: "none", persistence: "none" } as const;
const ALWAYS = { availability: "always", persistence: "none" } as const;
const TOGGLE = { availability: "toggle", persistence: "none" } as const;

/** Last-resort models only. Catalog metadata and live snapshots take precedence. */
export const FALLBACK_MODELS: Record<string, ModelDef[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o", reasoning: NONE, context: 128_000 },
    { id: "o3-mini", label: "o3 Mini", reasoning: { ...ALWAYS, effort: ["low", "medium", "high"] }, context: 200_000 },
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", reasoning: { ...ALWAYS, effort: ["low", "medium", "high", "max"] }, context: 200_000 },
  ],
  google: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", reasoning: ALWAYS, context: 1_000_000 },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", reasoning: TOGGLE, context: 1_000_000 },
  ],
  "google-vertex": [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", reasoning: ALWAYS, context: 1_000_000 },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", reasoning: TOGGLE, context: 1_000_000 },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat", reasoning: NONE, context: 128_000 },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner", reasoning: ALWAYS, context: 128_000 },
  ],
  "moonshotai-cn": [
    { id: "kimi-k3", label: "Kimi K3", reasoning: { availability: "always", persistence: "required", effort: ["low", "high", "max"] }, context: 256_000 },
    { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", reasoning: { availability: "always", persistence: "required" }, context: 256_000 },
    { id: "kimi-k2.6", label: "Kimi K2.6", reasoning: { availability: "toggle", persistence: "none" }, context: 256_000 },
    { id: "kimi-k2.5", label: "Kimi K2.5", reasoning: { availability: "toggle", persistence: "none" }, context: 256_000 },
  ],
  moonshotai: [
    { id: "kimi-k3", label: "Kimi K3", reasoning: { availability: "always", persistence: "required", effort: ["low", "high", "max"] }, context: 256_000 },
    { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", reasoning: { availability: "always", persistence: "required" }, context: 256_000 },
    { id: "kimi-k2.6", label: "Kimi K2.6", reasoning: { availability: "toggle", persistence: "none" }, context: 256_000 },
    { id: "kimi-k2.5", label: "Kimi K2.5", reasoning: { availability: "toggle", persistence: "none" }, context: 256_000 },
  ],
  "kimi-for-coding": [
    { id: "kimi-for-coding", label: "Kimi For Coding", reasoning: ALWAYS, context: 256_000 },
  ],
};

export interface LegacyProviderDef {
  canonicalId?: string;
  oldType: string;
  oldBaseUrl: string;
  canonicalName: string;
  canonicalType: ProviderType;
  canonicalBaseUrl: string;
  env: string[];
}

/** Compatibility facts used only while migrating the old built-in provider mirror. */
export const LEGACY_PROVIDERS: Record<string, LegacyProviderDef> = {
  "moonshotai-cn": { canonicalId: "moonshotai-cn", oldType: "openai", oldBaseUrl: "https://api.moonshot.cn/v1", canonicalName: "Moonshot AI (China)", canonicalType: "openai", canonicalBaseUrl: "https://api.moonshot.cn/v1", env: ["MOONSHOT_API_KEY"] },
  moonshotai: { canonicalId: "moonshotai", oldType: "openai", oldBaseUrl: "https://api.moonshot.ai/v1", canonicalName: "Moonshot AI", canonicalType: "openai", canonicalBaseUrl: "https://api.moonshot.ai/v1", env: ["MOONSHOT_API_KEY"] },
  "kimi-for-coding": { canonicalId: "kimi-for-coding", oldType: "openai", oldBaseUrl: "https://api.kimi.com/coding/v1", canonicalName: "Kimi For Coding", canonicalType: "anthropic", canonicalBaseUrl: "https://api.kimi.com/coding/v1", env: ["KIMI_API_KEY"] },
  google: { canonicalId: "google", oldType: "google-genai", oldBaseUrl: "https://generativelanguage.googleapis.com", canonicalName: "Google", canonicalType: "google-genai", canonicalBaseUrl: "https://generativelanguage.googleapis.com", env: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"] },
  "google-vertex": { canonicalId: "google-vertex", oldType: "vertexai", oldBaseUrl: "https://aiplatform.googleapis.com", canonicalName: "Google Vertex", canonicalType: "vertexai", canonicalBaseUrl: "https://aiplatform.googleapis.com", env: ["GOOGLE_VERTEX_PROJECT", "GOOGLE_VERTEX_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS"] },
  "alibaba-cn": { canonicalId: "alibaba-cn", oldType: "openai", oldBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", canonicalName: "Alibaba (China)", canonicalType: "openai", canonicalBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", env: ["DASHSCOPE_API_KEY"] },
  zhipuai: { canonicalId: "zhipuai", oldType: "openai", oldBaseUrl: "https://open.bigmodel.cn/api/paas/v4", canonicalName: "Zhipu AI", canonicalType: "openai", canonicalBaseUrl: "https://open.bigmodel.cn/api/paas/v4", env: ["ZHIPU_API_KEY"] },
  "fireworks-ai": { canonicalId: "fireworks-ai", oldType: "openai", oldBaseUrl: "https://api.fireworks.ai/inference/v1", canonicalName: "Fireworks AI", canonicalType: "openai", canonicalBaseUrl: "https://api.fireworks.ai/inference/v1", env: ["FIREWORKS_API_KEY"] },
  kimi: { canonicalId: "moonshotai-cn", oldType: "openai", oldBaseUrl: "https://api.moonshot.cn/v1", canonicalName: "Moonshot AI (China)", canonicalType: "openai", canonicalBaseUrl: "https://api.moonshot.cn/v1", env: ["MOONSHOT_API_KEY"] },
  "moonshot-ai": { canonicalId: "moonshotai", oldType: "openai", oldBaseUrl: "https://api.moonshot.ai/v1", canonicalName: "Moonshot AI", canonicalType: "openai", canonicalBaseUrl: "https://api.moonshot.ai/v1", env: ["MOONSHOT_API_KEY"] },
  "kimi-code": { canonicalId: "kimi-for-coding", oldType: "openai", oldBaseUrl: "https://api.kimi.com/coding/v1", canonicalName: "Kimi For Coding", canonicalType: "anthropic", canonicalBaseUrl: "https://api.kimi.com/coding/v1", env: ["KIMI_API_KEY"] },
  "google-genai": { canonicalId: "google", oldType: "google-genai", oldBaseUrl: "https://generativelanguage.googleapis.com", canonicalName: "Google", canonicalType: "google-genai", canonicalBaseUrl: "https://generativelanguage.googleapis.com", env: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"] },
  qwen: { canonicalId: "alibaba-cn", oldType: "openai", oldBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", canonicalName: "Alibaba (China)", canonicalType: "openai", canonicalBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", env: ["DASHSCOPE_API_KEY"] },
  zhipu: { canonicalId: "zhipuai", oldType: "openai", oldBaseUrl: "https://open.bigmodel.cn/api/paas/v4", canonicalName: "Zhipu AI", canonicalType: "openai", canonicalBaseUrl: "https://open.bigmodel.cn/api/paas/v4", env: ["ZHIPU_API_KEY"] },
  fireworks: { canonicalId: "fireworks-ai", oldType: "openai", oldBaseUrl: "https://api.fireworks.ai/inference/v1", canonicalName: "Fireworks AI", canonicalType: "openai", canonicalBaseUrl: "https://api.fireworks.ai/inference/v1", env: ["FIREWORKS_API_KEY"] },
  openai: { canonicalId: "openai", oldType: "openai", oldBaseUrl: "https://api.openai.com/v1", canonicalName: "OpenAI", canonicalType: "openai", canonicalBaseUrl: "https://api.openai.com/v1", env: ["OPENAI_API_KEY"] },
  anthropic: { canonicalId: "anthropic", oldType: "anthropic", oldBaseUrl: "https://api.anthropic.com", canonicalName: "Anthropic", canonicalType: "anthropic", canonicalBaseUrl: "https://api.anthropic.com", env: ["ANTHROPIC_API_KEY"] },
  deepseek: { canonicalId: "deepseek", oldType: "openai", oldBaseUrl: "https://api.deepseek.com", canonicalName: "DeepSeek", canonicalType: "openai", canonicalBaseUrl: "https://api.deepseek.com", env: ["DEEPSEEK_API_KEY"] },
  siliconflow: { canonicalId: "siliconflow-cn", oldType: "openai", oldBaseUrl: "https://api.siliconflow.cn/v1", canonicalName: "SiliconFlow (China)", canonicalType: "openai", canonicalBaseUrl: "https://api.siliconflow.cn/v1", env: ["SILICONFLOW_CN_API_KEY"] },
  minimax: { canonicalId: "minimax", oldType: "openai", oldBaseUrl: "https://api.minimax.chat/v1", canonicalName: "MiniMax (minimax.io)", canonicalType: "anthropic", canonicalBaseUrl: "https://api.minimax.io/anthropic/v1", env: ["MINIMAX_API_KEY"] },
  mistral: { canonicalId: "mistral", oldType: "openai", oldBaseUrl: "https://api.mistral.ai/v1", canonicalName: "Mistral", canonicalType: "openai", canonicalBaseUrl: "https://api.mistral.ai/v1", env: ["MISTRAL_API_KEY"] },
  groq: { canonicalId: "groq", oldType: "openai", oldBaseUrl: "https://api.groq.com/openai/v1", canonicalName: "Groq", canonicalType: "openai", canonicalBaseUrl: "https://api.groq.com/openai/v1", env: ["GROQ_API_KEY"] },
  xai: { canonicalId: "xai", oldType: "openai", oldBaseUrl: "https://api.x.ai/v1", canonicalName: "xAI", canonicalType: "openai", canonicalBaseUrl: "https://api.x.ai/v1", env: ["XAI_API_KEY"] },
  togetherai: { canonicalId: "togetherai", oldType: "openai", oldBaseUrl: "https://api.together.xyz/v1", canonicalName: "Together AI", canonicalType: "openai", canonicalBaseUrl: "https://api.together.xyz/v1", env: ["TOGETHER_API_KEY"] },
  openrouter: { canonicalId: "openrouter", oldType: "openai", oldBaseUrl: "https://openrouter.ai/api/v1", canonicalName: "OpenRouter", canonicalType: "openai", canonicalBaseUrl: "https://openrouter.ai/api/v1", env: ["OPENROUTER_API_KEY"] },
  perplexity: { canonicalId: "perplexity", oldType: "openai", oldBaseUrl: "https://api.perplexity.ai", canonicalName: "Perplexity", canonicalType: "openai", canonicalBaseUrl: "https://api.perplexity.ai", env: ["PERPLEXITY_API_KEY"] },
  cohere: { oldType: "openai", oldBaseUrl: "https://api.cohere.com/v2", canonicalName: "Cohere", canonicalType: "openai", canonicalBaseUrl: "https://api.cohere.com/v2", env: ["COHERE_API_KEY"] },
  deepinfra: { canonicalId: "deepinfra", oldType: "openai", oldBaseUrl: "https://api.deepinfra.com/v1/openai", canonicalName: "DeepInfra", canonicalType: "openai", canonicalBaseUrl: "https://api.deepinfra.com/v1/openai", env: ["DEEPINFRA_API_KEY"] },
  cerebras: { canonicalId: "cerebras", oldType: "openai", oldBaseUrl: "https://api.cerebras.ai/v1", canonicalName: "Cerebras", canonicalType: "openai", canonicalBaseUrl: "https://api.cerebras.ai/v1", env: ["CEREBRAS_API_KEY"] },
  volcengine: { oldType: "openai", oldBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", canonicalName: "Volcengine", canonicalType: "openai", canonicalBaseUrl: "https://ark.cn-beijing.volces.com/api/v3", env: [] },
  yi: { oldType: "openai", oldBaseUrl: "https://api.lingyiwanwu.com/v1", canonicalName: "Yi", canonicalType: "openai", canonicalBaseUrl: "https://api.lingyiwanwu.com/v1", env: [] },
  baichuan: { oldType: "openai", oldBaseUrl: "https://api.baichuan-ai.com/v1", canonicalName: "Baichuan", canonicalType: "openai", canonicalBaseUrl: "https://api.baichuan-ai.com/v1", env: [] },
};
