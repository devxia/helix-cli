import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import {
  FALLBACK_MODELS,
  DEFAULT_PROVIDERS,
  ENV_API_KEY_MAP,
  ENV_BASE_URL_MAP,
  ENV_MODEL_MAP,
  type ProviderDef,
} from "./config/providers.js";

// Re-export for consumers that import from config.js
export type { ProviderDef } from "./config/providers.js";
export { FALLBACK_MODELS, DEFAULT_PROVIDERS, ENV_API_KEY_MAP, ENV_BASE_URL_MAP, ENV_MODEL_MAP } from "./config/providers.js";

// ---------------------------------------------------------------------------
// Provider type
// ---------------------------------------------------------------------------

export type ProviderType = "openai" | "openai_responses" | "anthropic" | "google-genai" | "kimi" | "vertexai";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const providerSchema = z.object({
  name: z.string(),
  type: z.enum(["openai", "openai_responses", "anthropic", "google-genai", "kimi", "vertexai"]).default("openai"),
  base_url: z.string(),
  api_key: z.string().default(""),
});

const configSchema = z.object({
  active_provider: z.string().default("kimi"),
  active_model: z.string().default("kimi-k2"),
  thinking: z.boolean().default(true),
  providers: z.record(z.string(), providerSchema),
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
        reasoning: m.reasoning === true ? true : undefined,
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
      const desc = m.description ? `, description = "${tomlEscape(m.description)}"` : "";
      const reasoning = m.reasoning === true ? ", reasoning = true" : "";
      sections.push(`  { id = "${tomlEscape(m.id)}", label = "${tomlEscape(m.label)}"${desc}${reasoning} },`);
    }
    sections.push("]");
  }
  fs.writeFileSync(modelsCachePath(), sections.join("\n"), "utf-8");
  fs.chmodSync(modelsCachePath(), 0o600);
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

/** Escape a string for safe embedding in a TOML basic string literal. */
function tomlEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function stringifyConfig(cfg: Config): string {
  const lines: string[] = [];
  lines.push(`active_provider = "${tomlEscape(cfg.active_provider)}"`);
  lines.push(`active_model = "${tomlEscape(cfg.active_model)}"`);
  lines.push(`thinking = ${cfg.thinking}`);
  lines.push("");
  for (const [id, p] of Object.entries(cfg.providers as Record<string, ProviderConfig>)) {
    lines.push(`[providers.${id}]`);
    lines.push(`name = "${tomlEscape(p.name)}"`);
    lines.push(`type = "${tomlEscape(p.type)}"`);
    lines.push(`base_url = "${tomlEscape(p.base_url)}"`);
    lines.push(`api_key = "${tomlEscape(p.api_key)}"`);
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

/** In-memory config cache. Invalidated on save. */
let _configCache: Config | null = null;

export function loadConfig(): Config {
  if (_configCache) return _configCache;
  const file = configPath();
  if (!fs.existsSync(file)) {
    _configCache = defaultConfig();
    return _configCache;
  }
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = Bun.TOML.parse(raw);
    _configCache = configSchema.parse(parsed);
    return _configCache;
  } catch (err) {
    console.error(
      `Warning: failed to parse config at ${file}. Falling back to defaults. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    _configCache = defaultConfig();
    return _configCache;
  }
}

export function saveConfig(cfg: Config): void {
  ensureConfigDir();
  const validated = configSchema.parse(cfg);
  const file = configPath();
  fs.writeFileSync(file, stringifyConfig(validated), "utf-8");
  fs.chmodSync(file, 0o600);
  _configCache = validated;
}

/** Force reload from disk on next access (e.g. after external edit). */
export function invalidateConfigCache(): void {
  _configCache = null;
}

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

export function getActiveProvider(): ProviderConfig {
  const cfg = loadConfig();
  const activeId = cfg.active_provider;
  return (cfg.providers as Record<string, ProviderConfig>)[activeId] ?? DEFAULT_PROVIDERS.kimi!;
}

export function setProvider(providerId: string, apiKey: string): Config {
  const cfg = loadConfig();
  const provider = (cfg.providers as Record<string, ProviderConfig>)[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  provider.api_key = apiKey;

  const sameProvider = cfg.active_provider === providerId;
  cfg.active_provider = providerId;

  if (!sameProvider) {
    // Reset model to the provider's first available model when switching providers.
    const models = getAvailableModels(providerId);
    cfg.active_model = models[0]?.id ?? providerId;
  }

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
    if (remaining.length > 0) {
      cfg.active_provider = remaining[0]!;
    } else {
      // Fall back to the default kimi provider so the config stays consistent.
      cfg.providers["kimi"] = { ...DEFAULT_PROVIDERS.kimi! };
      cfg.active_provider = "kimi";
    }
    const models = getAvailableModels(cfg.active_provider);
    cfg.active_model = models[0]?.id ?? "";
  }
  saveConfig(cfg);
  return cfg;
}

export function listProviders(): Array<{ id: string } & ProviderConfig> {
  const cfg = loadConfig();
  return Object.entries(cfg.providers as Record<string, ProviderConfig>).map(([id, p]) => ({ id, ...p }));
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
  const provider = (config.providers as Record<string, ProviderConfig>)[providerId];
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
    const normalized = baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${normalized}/models`, {
      headers: apiKey
        ? { Authorization: `Bearer ${apiKey}`, "User-Agent": "HelixCLI/1.0" }
        : { "User-Agent": "HelixCLI/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body = (await res.json()) as { data?: Array<{ id: string }> };
    if (!Array.isArray(body.data)) throw new Error("Unexpected response shape");

    const metadata = new Map<string, ModelDef>();
    for (const m of modelCache().get(providerId) ?? []) {
      metadata.set(m.id, m);
    }
    for (const m of FALLBACK_MODELS[providerId] ?? []) {
      if (!metadata.has(m.id)) metadata.set(m.id, m);
    }

    const models: ModelDef[] = body.data
      .filter((m) => m.id && typeof m.id === "string")
      .map((m) => {
        const existing = metadata.get(m.id);
        return {
          id: m.id,
          label: existing?.label ?? m.id,
          description: existing?.description,
          reasoning: existing?.reasoning,
        };
      });

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
