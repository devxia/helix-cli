import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Provider type
// ---------------------------------------------------------------------------

export type ProviderType = "openai" | "anthropic" | "google-genai" | "kimi" | "vertexai";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const providerSchema = z.object({
  name: z.string(),
  type: z.enum(["openai", "anthropic", "google-genai", "kimi", "vertexai"]).default("openai"),
  base_url: z.string(),
  api_key: z.string().default(""),
});

const configSchema = z.object({
  active_provider: z.string().default("kimi"),
  active_model: z.string().default("kimi-k2"),
  thinking: z.boolean().default(true),
  providers: z.record(providerSchema),
});

export type ProviderConfig = z.infer<typeof providerSchema>;
export type Config = z.infer<typeof configSchema>;

// ---------------------------------------------------------------------------
// Available models — persisted to disk, auto-refreshed from API
// ---------------------------------------------------------------------------

export interface ModelDef {
  id: string;
  label: string;
  description?: string;
  /** Whether the model supports thinking / reasoning. */
  reasoning?: boolean;
}

/** Hardcoded fallback when neither disk cache nor API is available. */
const FALLBACK_MODELS: Record<string, ModelDef[]> = {
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
// Disk cache for models — persisted across sessions
// ---------------------------------------------------------------------------

function modelsCachePath(): string {
  return path.join(configDir(), "models_cache.toml");
}

function loadModelsFromDisk(): Map<string, ModelDef[]> {
  const cache = new Map<string, ModelDef[]>();
  const file = modelsCachePath();
  if (!fs.existsSync(file)) return cache;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = Bun.TOML.parse(raw) as Record<string, unknown>;
    for (const [id, entry] of Object.entries(parsed)) {
      const arr = (entry as Record<string, unknown> | undefined)?.models;
      if (!Array.isArray(arr)) continue;
      cache.set(id, arr.map((m: Record<string, unknown>) => ({
        id: String(m.id ?? ""),
        label: String(m.label ?? m.id ?? ""),
        description: m.description ? String(m.description) : undefined,
      })));
    }
  } catch { /* corrupt → ignore */ }
  return cache;
}

function saveModelsToDisk(cache: Map<string, ModelDef[]>): void {
  ensureConfigDir();
  const sections: string[] = [];
  for (const [id, models] of cache) {
    sections.push(`\n[${id}]\nmodels = [`);
    for (const m of models) {
      const desc = m.description ? `, description = "${m.description.replace(/"/g, '\\"')}"` : "";
      sections.push(`  { id = "${m.id}", label = "${m.label}"${desc} },`);
    }
    sections.push("]");
  }
  fs.writeFileSync(modelsCachePath(), sections.join("\n"), "utf-8");
}

/** In-memory cache, lazily loaded from disk on first access. */
let _modelCache: Map<string, ModelDef[]> | null = null;

function modelCache(): Map<string, ModelDef[]> {
  if (!_modelCache) {
    _modelCache = loadModelsFromDisk();
  }
  return _modelCache;
}

// ---------------------------------------------------------------------------
// Default providers
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDERS: Record<string, ProviderConfig> = {
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

const ENV_API_KEY_MAP: Record<string, string> = {
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

const ENV_BASE_URL_MAP: Record<string, string> = {
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
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function configDir(): string {
  return path.join(os.homedir(), ".helix");
}

function configPath(): string {
  return path.join(configDir(), "config.toml");
}

// ---------------------------------------------------------------------------
// TOML helpers
// ---------------------------------------------------------------------------

function stringifyConfig(cfg: Config): string {
  const lines: string[] = [];
  lines.push(`active_provider = "${cfg.active_provider}"`);
  lines.push(`active_model = "${cfg.active_model}"`);
  lines.push(`thinking = ${cfg.thinking}`);
  lines.push("");
  for (const [id, p] of Object.entries(cfg.providers)) {
    lines.push(`[providers.${id}]`);
    lines.push(`name = "${p.name}"`);
    lines.push(`type = "${p.type}"`);
    lines.push(`base_url = "${p.base_url}"`);
    lines.push(`api_key = "${p.api_key}"`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

function ensureConfigDir(): void {
  const dir = configDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function defaultConfig(): Config {
  return {
    active_provider: "kimi",
    active_model: "kimi-k2",
    thinking: true,
    providers: { ...DEFAULT_PROVIDERS },
  };
}

export function loadConfig(): Config {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return defaultConfig();
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = Bun.TOML.parse(raw);
    return configSchema.parse(parsed);
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: Config): void {
  ensureConfigDir();
  const validated = configSchema.parse(cfg);
  fs.writeFileSync(configPath(), stringifyConfig(validated), "utf-8");
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

export function getActiveProvider(): ProviderConfig {
  const cfg = loadConfig();
  const activeId = cfg.active_provider;
  return cfg.providers[activeId] ?? DEFAULT_PROVIDERS.kimi!;
}

export function setProvider(providerId: string, apiKey: string): Config {
  const cfg = loadConfig();
  const provider = cfg.providers[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  provider.api_key = apiKey;
  cfg.active_provider = providerId;
  // Reset model to the provider's first available model when switching
  const models = getAvailableModels(providerId);
  cfg.active_model = models[0]?.id ?? providerId;
  saveConfig(cfg);
  return cfg;
}

/**
 * Add a custom provider to the config.
 */
export function addCustomProvider(
  id: string,
  name: string,
  type: ProviderType,
  baseUrl: string,
  apiKey: string,
  models?: ModelDef[],
): Config {
  const cfg = loadConfig();
  cfg.providers[id] = {
    name,
    type,
    base_url: baseUrl,
    api_key: apiKey,
  };
  // Store models if provided
  if (models && models.length > 0) {
    modelCache().set(id, models);
    saveModelsToDisk(modelCache());
  }
  cfg.active_provider = id;
  const available = models ?? getAvailableModels(id);
  cfg.active_model = available[0]?.id ?? id;
  saveConfig(cfg);
  return cfg;
}

/**
 * Remove a provider from the config. If it was active, switch to another.
 */
export function removeProvider(providerId: string): Config {
  const cfg = loadConfig();
  delete cfg.providers[providerId];
  // If deleted was active, switch to first remaining
  if (cfg.active_provider === providerId) {
    const remaining = Object.keys(cfg.providers);
    cfg.active_provider = remaining[0] ?? "kimi";
    const models = getAvailableModels(cfg.active_provider);
    cfg.active_model = models[0]?.id ?? "";
  }
  saveConfig(cfg);
  return cfg;
}

export function listProviders(): Array<{ id: string } & ProviderConfig> {
  const cfg = loadConfig();
  return Object.entries(cfg.providers).map(([id, p]) => ({ id, ...p }));
}

/**
 * Check whether a provider has credentials configured (API key in config or env var).
 */
export function hasApiKey(providerId: string, provider: ProviderConfig): boolean {
  return resolveApiKey(providerId, provider) !== "";
}

/**
 * Resolve the effective API key for a provider, checking env vars first.
 */
export function resolveApiKey(providerId: string, provider: ProviderConfig): string {
  const envVar = ENV_API_KEY_MAP[providerId];
  if (envVar) {
    const envValue = process.env[envVar];
    if (envValue) return envValue;
  }
  return provider.api_key;
}

/**
 * Resolve the effective base URL for a provider, checking env vars first.
 */
export function resolveBaseUrl(providerId: string, provider: ProviderConfig): string {
  const envVar = ENV_BASE_URL_MAP[providerId];
  if (envVar) {
    const envValue = process.env[envVar];
    if (envValue) return envValue;
  }
  return provider.base_url;
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the model list from a provider's /v1/models endpoint.
 * Persists to disk cache so the list survives restarts.
 */
export async function refreshProviderModels(providerId: string): Promise<ModelDef[]> {
  const config = loadConfig();
  const provider = config.providers[providerId];
  if (!provider) return FALLBACK_MODELS[providerId] ?? [];

  const apiKey = resolveApiKey(providerId, provider);
  const baseUrl = resolveBaseUrl(providerId, provider);

  // Only OpenAI-compatible providers support /v1/models
  if (provider.type !== "openai" && provider.type !== "kimi") {
    const fallback = modelCache().get(providerId) ?? FALLBACK_MODELS[providerId] ?? [];
    modelCache().set(providerId, fallback);
    return fallback;
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: apiKey
        ? { Authorization: `Bearer ${apiKey}`, "User-Agent": "HelixCLI/1.0" }
        : { "User-Agent": "HelixCLI/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = (await res.json()) as { data?: Array<{ id: string }> };
    if (!Array.isArray(body.data)) throw new Error("Unexpected response shape");

    const models: ModelDef[] = body.data
      .filter((m) => m.id && typeof m.id === "string")
      .map((m) => ({ id: m.id, label: m.id }));

    if (models.length === 0) throw new Error("Empty model list");

    modelCache().set(providerId, models);
    saveModelsToDisk(modelCache());
    return models;
  } catch {
    // API unreachable → keep existing disk cache or use hardcoded
    const fallback = modelCache().get(providerId) ?? FALLBACK_MODELS[providerId] ?? [];
    modelCache().set(providerId, fallback);
    return fallback;
  }
}

export function getAvailableModels(providerId: string): ModelDef[] {
  return modelCache().get(providerId) ?? FALLBACK_MODELS[providerId] ?? [];
}

/**
 * Set models for a provider (e.g. from catalog).
 */
export function setProviderModels(providerId: string, models: ModelDef[]): void {
  modelCache().set(providerId, models);
  saveModelsToDisk(modelCache());
}

export function getActiveModel(): string {
  return loadConfig().active_model;
}

export function setActiveModel(modelId: string): void {
  const cfg = loadConfig();
  cfg.active_model = modelId;
  saveConfig(cfg);
}

// ---------------------------------------------------------------------------
// Thinking helpers
// ---------------------------------------------------------------------------

export function isThinkingEnabled(): boolean {
  return loadConfig().thinking;
}

export function setThinkingEnabled(enabled: boolean): void {
  const cfg = loadConfig();
  cfg.thinking = enabled;
  saveConfig(cfg);
}
