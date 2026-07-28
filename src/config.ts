import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import { FALLBACK_MODELS, LEGACY_PROVIDERS } from "./config/providers.js";

export type ProviderType = "openai" | "anthropic" | "google-genai" | "vertexai";
export type ProviderSource = "catalog" | "custom";
export type ReasoningAvailability = "none" | "always" | "toggle";
export type ThinkingPersistence = "none" | "optional" | "required";

export interface ReasoningCapability {
  availability: ReasoningAvailability;
  effort?: string[];
  persistence: ThinkingPersistence;
}

export interface ThinkingPreference {
  enabled: boolean;
  effort?: string;
}

export interface ModelDef {
  id: string;
  label: string;
  description?: string;
  reasoning: ReasoningCapability;
  /** False only when a live ID has not yet been enriched by authoritative metadata. */
  reasoningKnown?: boolean;
  context?: number;
  output?: number;
}

const providerSchema = z.object({
  name: z.string(),
  type: z.enum(["openai", "anthropic", "google-genai", "vertexai"]),
  source: z.enum(["catalog", "custom"]),
  base_url: z.string(),
  api_key: z.string().default(""),
  env: z.array(z.string()).optional(),
});
const preferenceSchema = z.object({ enabled: z.boolean(), effort: z.string().optional() });
const configSchema = z.object({
  active_provider: z.string().optional(),
  active_model: z.string().optional(),
  providers: z.record(z.string(), providerSchema).default({}),
  thinking_preferences: z.record(z.string(), z.record(z.string(), preferenceSchema)).default({}),
  legacy_thinking: z.boolean().optional(),
});

export type ProviderConfig = z.infer<typeof providerSchema>;
export type Config = z.infer<typeof configSchema>;

export interface LiveModelSnapshot {
  source: "live";
  fetched_at: number;
  models: ModelDef[];
}

export type ResolvedCredentials =
  | { kind: "api-key"; apiKey: string }
  | { kind: "vertex"; project: string; location: string }
  | { kind: "missing" };

const NONE: ReasoningCapability = { availability: "none", persistence: "none" };
const SNAPSHOT_TTL = 60 * 60 * 1000;
let homeOverride: string | undefined;
let _configCache: Config | null = null;
let _snapshotCache: Map<string, LiveModelSnapshot> | null = null;
const catalogMetadata = new Map<string, ModelDef[]>();
const modelRefreshes = new Map<string, Promise<ModelDef[]>>();

function configDir(): string { return path.join(homeOverride ?? os.homedir(), ".helix"); }
function configPath(): string { return path.join(configDir(), "config.toml"); }
function snapshotsPath(): string { return path.join(configDir(), "models_cache.toml"); }
function ensureConfigDir(): void { fs.mkdirSync(configDir(), { recursive: true }); }
function normalizeUrl(value: string): string { return value.trim().replace(/\/+$/, "").toLowerCase(); }
function tomlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}
function q(value: string): string { return `"${tomlEscape(value)}"`; }

function stringifyConfig(config: Config): string {
  const lines: string[] = [];
  if (config.active_provider) lines.push(`active_provider = ${q(config.active_provider)}`);
  if (config.active_model) lines.push(`active_model = ${q(config.active_model)}`);
  if (config.legacy_thinking !== undefined) lines.push(`legacy_thinking = ${config.legacy_thinking}`);
  if (lines.length) lines.push("");
  for (const [id, provider] of Object.entries(config.providers)) {
    lines.push(`[providers.${q(id)}]`);
    lines.push(`name = ${q(provider.name)}`);
    lines.push(`type = ${q(provider.type)}`);
    lines.push(`source = ${q(provider.source)}`);
    lines.push(`base_url = ${q(provider.base_url)}`);
    lines.push(`api_key = ${q(provider.api_key)}`);
    if (provider.env) lines.push(`env = [${provider.env.map(q).join(", ")}]`);
    lines.push("");
  }
  for (const [providerId, models] of Object.entries(config.thinking_preferences)) {
    for (const [modelId, preference] of Object.entries(models)) {
      lines.push(`[thinking_preferences.${q(providerId)}.${q(modelId)}]`);
      lines.push(`enabled = ${preference.enabled}`);
      if (preference.effort) lines.push(`effort = ${q(preference.effort)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function uniqueCustomId(base: string, providers: Record<string, ProviderConfig>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
  let id = `custom-${slug}`;
  let suffix = 2;
  while (providers[id]) id = `custom-${slug}-${suffix++}`;
  return id;
}

/** Pure, offline migration from the v1 provider mirror and current config shape. */
export function migrateLegacyConfig(raw: unknown): { config: Config; changed: boolean; idMap: Map<string, string> } {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawProviders = source.providers && typeof source.providers === "object"
    ? source.providers as Record<string, unknown> : {};
  const providers: Record<string, ProviderConfig> = {};
  const idMap = new Map<string, string>();
  const owners = new Map<string, string>();
  const activeOld = typeof source.active_provider === "string" ? source.active_provider : undefined;

  const place = (oldId: string, target: string, candidate: ProviderConfig): void => {
    const existing = providers[target];
    if (!existing) {
      providers[target] = candidate;
      owners.set(target, oldId);
      idMap.set(oldId, target);
      return;
    }
    const sameConnection = existing.type === candidate.type && normalizeUrl(existing.base_url) === normalizeUrl(candidate.base_url);
    const keysConflict = !!existing.api_key && !!candidate.api_key && existing.api_key !== candidate.api_key;
    if (sameConnection && !keysConflict) {
      if (!existing.api_key && candidate.api_key) existing.api_key = candidate.api_key;
      if (candidate.source === "catalog") {
        existing.source = "catalog";
        existing.name = candidate.name;
        existing.env = candidate.env;
      }
      idMap.set(oldId, target);
      return;
    }

    const existingOwner = owners.get(target);
    const candidateMustOwnCanonical = candidate.source === "catalog" && (
      existing.source === "custom" || oldId === activeOld
    );
    if (candidateMustOwnCanonical) {
      const customId = uniqueCustomId(existing.name, providers);
      providers[customId] = { ...existing, source: "custom", env: undefined };
      if (existingOwner) idMap.set(existingOwner, customId);
      providers[target] = candidate;
      owners.set(target, oldId);
      idMap.set(oldId, target);
      return;
    }
    const customId = uniqueCustomId(candidate.name, providers);
    providers[customId] = { ...candidate, source: "custom", env: undefined };
    owners.set(customId, oldId);
    idMap.set(oldId, customId);
  };

  for (const [oldId, value] of Object.entries(rawProviders)) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : oldId;
    const oldType = typeof item.type === "string" ? item.type : "openai";
    const baseUrl = typeof item.base_url === "string" ? item.base_url : "";
    const apiKey = typeof item.api_key === "string" ? item.api_key : "";
    const sourceKind = item.source;

    if (sourceKind === "catalog" || sourceKind === "custom") {
      const parsed = providerSchema.safeParse(item);
      if (parsed.success) place(oldId, oldId, parsed.data);
      continue;
    }

    const globalSiliconFlow = oldId === "siliconflow"
      && oldType === "openai"
      && normalizeUrl(baseUrl) === normalizeUrl("https://api.siliconflow.com/v1");
    const legacy = globalSiliconFlow ? {
      canonicalId: "siliconflow",
      oldType: "openai",
      oldBaseUrl: "https://api.siliconflow.com/v1",
      canonicalName: "SiliconFlow",
      canonicalType: "openai" as const,
      canonicalBaseUrl: "https://api.siliconflow.com/v1",
      env: ["SILICONFLOW_API_KEY"],
    } : LEGACY_PROVIDERS[oldId];
    if (oldType === "openai_responses") {
      if (apiKey || oldId === activeOld || baseUrl) throw new Error("Unsupported legacy provider protocol");
      continue;
    }
    if (legacy) {
      const legacyDefault = oldType === legacy.oldType && normalizeUrl(baseUrl) === normalizeUrl(legacy.oldBaseUrl);
      const currentCanonical = oldId === legacy.canonicalId
        && normalizeUrl(baseUrl) === normalizeUrl(legacy.canonicalBaseUrl)
        && (oldType === legacy.oldType || oldType === legacy.canonicalType);
      const untouched = legacyDefault || currentCanonical;
      const meaningful = apiKey.length > 0 || oldId === activeOld || !untouched;
      if (!meaningful) continue;
      if (untouched && legacy.canonicalId) {
        const target = legacy.canonicalId;
        const canonical: ProviderConfig = {
          name: legacy.canonicalName,
          type: legacy.canonicalType,
          source: "catalog",
          base_url: legacy.canonicalBaseUrl,
          api_key: apiKey,
          env: legacy.env,
        };
        place(oldId, target, canonical);
      } else {
        const target = uniqueCustomId(name, providers);
        const type: ProviderType = oldType === "kimi" ? "openai" :
          (["openai", "anthropic", "google-genai", "vertexai"] as string[]).includes(oldType)
            ? oldType as ProviderType : "openai";
        providers[target] = { name, type, source: "custom", base_url: baseUrl, api_key: apiKey };
        idMap.set(oldId, target);
      }
      continue;
    }

    if (apiKey || oldId === activeOld || baseUrl) {
      const target = uniqueCustomId(name, providers);
      const type: ProviderType = (["openai", "anthropic", "google-genai", "vertexai"] as string[]).includes(oldType)
        ? oldType as ProviderType : "openai";
      providers[target] = { name, type, source: "custom", base_url: baseUrl, api_key: apiKey };
      idMap.set(oldId, target);
    }
  }

  const activeProvider = activeOld ? idMap.get(activeOld) : undefined;
  const activeModel = activeProvider && typeof source.active_model === "string" ? source.active_model : undefined;
  const oldPreferences = source.thinking_preferences && typeof source.thinking_preferences === "object"
    ? source.thinking_preferences : {};
  const config = configSchema.parse({
    active_provider: activeProvider,
    active_model: activeModel,
    providers,
    thinking_preferences: oldPreferences,
    legacy_thinking: source.thinking === false ? false : source.legacy_thinking,
  });
  return { config, changed: true, idMap };
}

export function defaultConfig(): Config {
  return { providers: {}, thinking_preferences: {} };
}

function atomicWriteConfig(config: Config): void {
  ensureConfigDir();
  const file = configPath();
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, stringifyConfig(config), { encoding: "utf-8", mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
}

export function loadConfig(): Config {
  if (_configCache) return _configCache;
  const file = configPath();
  if (!fs.existsSync(file)) return (_configCache = defaultConfig());
  try {
    const raw = Bun.TOML.parse(fs.readFileSync(file, "utf-8"));
    const current = configSchema.safeParse(raw);
    if (current.success && Object.values(current.data.providers).every((p) => p.source)) {
      return (_configCache = current.data);
    }
    const migrated = migrateLegacyConfig(raw).config;
    atomicWriteConfig(migrated);
    return (_configCache = migrated);
  } catch {
    console.error(`Warning: failed to parse or migrate config at ${file}. Using an empty in-memory config; the original file was not changed.`);
    return (_configCache = defaultConfig());
  }
}

export function saveConfig(config: Config): void {
  const validated = configSchema.parse(config);
  atomicWriteConfig(validated);
  _configCache = validated;
  pruneModelSnapshots(Object.keys(validated.providers));
}

export function invalidateConfigCache(): void { _configCache = null; }
export function setConfigHomeForTests(home?: string): void {
  homeOverride = home;
  _configCache = null;
  _snapshotCache = null;
  catalogMetadata.clear();
  modelRefreshes.clear();
}

export function getActiveProvider(): ProviderConfig | undefined {
  const config = loadConfig();
  return config.active_provider ? config.providers[config.active_provider] : undefined;
}
export function listProviders(): Array<{ id: string } & ProviderConfig> {
  return Object.entries(loadConfig().providers).map(([id, provider]) => ({ id, ...provider }));
}

export function configureCatalogProvider(
  id: string,
  entry: { name: string; env?: string[] },
  type: ProviderType,
  baseUrl: string,
  apiKey = "",
  models: ModelDef[] = [],
): Config {
  const config = loadConfig();
  const wasActive = config.active_provider === id;
  const existingKey = config.providers[id]?.api_key ?? "";
  config.providers[id] = { name: entry.name || id, type, source: "catalog", base_url: baseUrl, api_key: apiKey || existingKey, env: [...(entry.env ?? [])] };
  config.active_provider = id;
  if (models.length) setCatalogProviderModels(id, models);
  if (!wasActive) {
    const available = models.length ? models : getAvailableModels(id);
    config.active_model = available[0]?.id ?? config.active_model;
  }
  saveConfig(config);
  return config;
}

export function setProvider(providerId: string, apiKey: string): Config {
  const config = loadConfig();
  const provider = config.providers[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  if (apiKey) provider.api_key = apiKey;
  const wasActive = config.active_provider === providerId;
  config.active_provider = providerId;
  if (!wasActive) config.active_model = getAvailableModels(providerId)[0]?.id ?? config.active_model;
  saveConfig(config);
  return config;
}

export function addCustomProvider(
  idHint: string,
  name: string,
  type: ProviderType,
  baseUrl: string,
  apiKey: string,
  models: ModelDef[] = [],
): Config {
  const config = loadConfig();
  const id = uniqueCustomId(idHint || name, config.providers);
  config.providers[id] = { name, type, source: "custom", base_url: baseUrl, api_key: apiKey };
  config.active_provider = id;
  if (models.length) setCatalogProviderModels(id, models);
  config.active_model = models[0]?.id ?? id;
  saveConfig(config);
  return config;
}

export function removeProvider(providerId: string): Config {
  const config = loadConfig();
  delete config.providers[providerId];
  delete config.thinking_preferences[providerId];
  if (config.active_provider === providerId) {
    const next = Object.keys(config.providers)[0];
    config.active_provider = next;
    config.active_model = next ? getAvailableModels(next)[0]?.id : undefined;
  }
  saveConfig(config);
  return config;
}

export function setActiveSelection(providerId: string, modelId: string): void {
  const config = loadConfig();
  if (!config.providers[providerId]) throw new Error(`Unknown provider: ${providerId}`);
  config.active_provider = providerId;
  config.active_model = modelId;
  saveConfig(config);
}
export function setActiveModel(modelId: string): void {
  const config = loadConfig();
  if (!config.active_provider) return;
  setActiveSelection(config.active_provider, modelId);
}

export function resolveCredentials(provider: ProviderConfig, env: Record<string, string | undefined> = process.env): ResolvedCredentials {
  if (provider.type === "vertexai") {
    const project = env.GOOGLE_VERTEX_PROJECT?.trim() ?? "";
    const location = env.GOOGLE_VERTEX_LOCATION?.trim() ?? "";
    return project && location ? { kind: "vertex", project, location } : { kind: "missing" };
  }
  if (provider.source === "catalog") {
    for (const name of provider.env ?? []) {
      const value = env[name]?.trim();
      if (value) return { kind: "api-key", apiKey: value };
    }
  }
  return provider.api_key.trim() ? { kind: "api-key", apiKey: provider.api_key.trim() } : { kind: "missing" };
}
export function hasCredentials(provider: ProviderConfig): boolean { return resolveCredentials(provider).kind !== "missing"; }

function validCapability(value: unknown): ReasoningCapability {
  if (!value || typeof value !== "object") return { ...NONE };
  const item = value as Record<string, unknown>;
  const availability = item.availability;
  const persistence = item.persistence;
  if (!(["none", "always", "toggle"] as unknown[]).includes(availability)) return { ...NONE };
  return {
    availability: availability as ReasoningAvailability,
    persistence: (["none", "optional", "required"] as unknown[]).includes(persistence)
      ? persistence as ThinkingPersistence : "none",
    effort: Array.isArray(item.effort) ? item.effort.filter((v): v is string => typeof v === "string") : undefined,
  };
}
function validModel(value: unknown): ModelDef | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id) return null;
  return {
    id: item.id,
    label: typeof item.label === "string" ? item.label : item.id,
    description: typeof item.description === "string" ? item.description : undefined,
    reasoning: validCapability(item.reasoning),
    reasoningKnown: typeof item.reasoning_known === "boolean" ? item.reasoning_known : (typeof item.reasoningKnown === "boolean" ? item.reasoningKnown : undefined),
    context: typeof item.context === "number" ? item.context : undefined,
    output: typeof item.output === "number" ? item.output : undefined,
  };
}
function snapshots(): Map<string, LiveModelSnapshot> {
  if (_snapshotCache) return _snapshotCache;
  const result = new Map<string, LiveModelSnapshot>();
  try {
    const parsed = Bun.TOML.parse(fs.readFileSync(snapshotsPath(), "utf-8")) as Record<string, unknown>;
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      // Old v1 sections contained only models; their membership provenance is ambiguous.
      if (item.source !== "live" || typeof item.fetched_at !== "number" || !Array.isArray(item.models)) continue;
      const models = item.models.map(validModel).filter((model): model is ModelDef => model !== null);
      if (models.length) result.set(id, { source: "live", fetched_at: item.fetched_at, models });
    }
  } catch { /* Corrupt or legacy cache is ignored without rewriting it. */ }
  return (_snapshotCache = result);
}
function modelToml(model: ModelDef): string {
  const fields = [`id = ${q(model.id)}`, `label = ${q(model.label)}`];
  if (model.description) fields.push(`description = ${q(model.description)}`);
  fields.push(`reasoning_known = ${model.reasoningKnown !== false}`);
  const reasoning = [`availability = ${q(model.reasoning.availability)}`, `persistence = ${q(model.reasoning.persistence)}`];
  if (model.reasoning.effort?.length) reasoning.push(`effort = [${model.reasoning.effort.map(q).join(", ")}]`);
  fields.push(`reasoning = { ${reasoning.join(", ")} }`);
  if (model.context !== undefined) fields.push(`context = ${model.context}`);
  if (model.output !== undefined) fields.push(`output = ${model.output}`);
  return `{ ${fields.join(", ")} }`;
}
function saveSnapshots(): void {
  ensureConfigDir();
  const configured = new Set(Object.keys(loadConfig().providers));
  const lines: string[] = [];
  for (const [id, snapshot] of snapshots()) {
    if (!configured.has(id)) continue;
    lines.push(`[${q(id)}]`, `source = "live"`, `fetched_at = ${snapshot.fetched_at}`, "models = [");
    for (const model of snapshot.models) lines.push(`  ${modelToml(model)},`);
    lines.push("]", "");
  }
  fs.writeFileSync(snapshotsPath(), lines.join("\n"), { encoding: "utf-8", mode: 0o600 });
  fs.chmodSync(snapshotsPath(), 0o600);
}
export function pruneModelSnapshots(providerIds: string[]): void {
  const allowed = new Set(providerIds);
  let changed = false;
  for (const id of snapshots().keys()) if (!allowed.has(id)) { snapshots().delete(id); changed = true; }
  if (changed) saveSnapshots();
}
export function setCatalogProviderModels(providerId: string, models: ModelDef[]): void {
  catalogMetadata.set(providerId, models.map((model) => ({ ...model, reasoningKnown: model.reasoningKnown !== false, reasoning: { ...model.reasoning, effort: model.reasoning.effort ? [...model.reasoning.effort] : undefined } })));
}
export function mergeLiveWithCatalog(live: ModelDef[], metadata: ModelDef[]): ModelDef[] {
  const byId = new Map(metadata.map((model) => [model.id, model]));
  return live.map((model) => {
    const rich = byId.get(model.id);
    return rich ? { ...model, ...rich, id: model.id } : model;
  });
}
export function getAvailableModels(providerId: string): ModelDef[] {
  const snapshot = snapshots().get(providerId);
  const metadata = catalogMetadata.get(providerId) ?? [];
  if (snapshot) return mergeLiveWithCatalog(snapshot.models, metadata);
  if (metadata.length) return metadata;
  return FALLBACK_MODELS[providerId] ?? [];
}
export interface RefreshOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
}
async function fetchLiveModels(providerId: string, options: RefreshOptions): Promise<ModelDef[]> {
  const before = loadConfig().providers[providerId];
  if (!before || before.type !== "openai") return getAvailableModels(providerId);
  const fingerprint = `${before.type}\0${before.base_url}\0${before.source}`;
  const credentials = resolveCredentials(before);
  const response = await (options.fetchFn ?? fetch)(`${before.base_url.replace(/\/+$/, "")}/models`, {
    headers: credentials.kind === "api-key"
      ? { Authorization: `Bearer ${credentials.apiKey}`, "User-Agent": "HelixCLI/1.5" }
      : { "User-Agent": "HelixCLI/1.5" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: unknown }> };
  const ids = Array.isArray(body.data) ? body.data.map((entry) => entry.id).filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  if (!ids.length) throw new Error("Empty model list");
  const current = loadConfig().providers[providerId];
  if (!current || `${current.type}\0${current.base_url}\0${current.source}` !== fingerprint) return getAvailableModels(providerId);
  const metadata = catalogMetadata.get(providerId) ?? FALLBACK_MODELS[providerId] ?? [];
  const models = ids.map((id) => ({ id, label: id, reasoning: { ...NONE }, reasoningKnown: false }));
  const snapshot: LiveModelSnapshot = { source: "live", fetched_at: (options.now ?? Date.now)(), models: mergeLiveWithCatalog(models, metadata) };
  snapshots().set(providerId, snapshot);
  saveSnapshots();
  return mergeLiveWithCatalog(snapshot.models, catalogMetadata.get(providerId) ?? []);
}
export async function refreshProviderModels(providerId: string, options: RefreshOptions = {}): Promise<ModelDef[]> {
  const provider = loadConfig().providers[providerId];
  if (!provider || provider.type !== "openai") return getAvailableModels(providerId);
  const existing = snapshots().get(providerId);
  const now = (options.now ?? Date.now)();
  if (existing && now - existing.fetched_at < SNAPSHOT_TTL) return getAvailableModels(providerId);
  const run = () => {
    const active = modelRefreshes.get(providerId);
    if (active) return active;
    const promise = fetchLiveModels(providerId, options)
      .catch(() => getAvailableModels(providerId))
      .finally(() => modelRefreshes.delete(providerId));
    modelRefreshes.set(providerId, promise);
    return promise;
  };
  if (existing) {
    void run();
    return getAvailableModels(providerId);
  }
  return run();
}

export function resolveThinkingPreference(providerId: string, model: ModelDef): ThinkingPreference {
  const config = loadConfig();
  if (config.legacy_thinking !== undefined
    && model.reasoningKnown !== false
    && config.active_provider === providerId
    && config.active_model === model.id) {
    if (config.legacy_thinking === false && model.reasoning.availability === "toggle") {
      config.thinking_preferences[providerId] ??= {};
      config.thinking_preferences[providerId]![model.id] = { enabled: false };
    }
    delete config.legacy_thinking;
    saveConfig(config);
  }
  const stored = config.thinking_preferences[providerId]?.[model.id];
  if (model.reasoning.availability === "none") return { enabled: false };
  if (!stored) return { enabled: true };
  const enabled = model.reasoning.availability === "toggle" ? stored.enabled : true;
  const effort = enabled && stored.effort && model.reasoning.effort?.includes(stored.effort) ? stored.effort : undefined;
  return { enabled, effort };
}
export function setThinkingPreference(providerId: string, model: ModelDef, preference: ThinkingPreference): void {
  const config = loadConfig();
  if (model.reasoning.availability === "none") return;
  const enabled = model.reasoning.availability === "toggle" ? preference.enabled : true;
  const effort = enabled && preference.effort && model.reasoning.effort?.includes(preference.effort) ? preference.effort : undefined;
  config.thinking_preferences[providerId] ??= {};
  config.thinking_preferences[providerId]![model.id] = { enabled, effort };
  saveConfig(config);
}
export interface ThinkingState extends ThinkingPreference { label: string; }
export function thinkingStates(capability: ReasoningCapability): ThinkingState[] {
  if (capability.availability === "none") return [];
  const states: ThinkingState[] = [];
  if (capability.availability === "toggle") states.push({ label: "OFF", enabled: false });
  if (!capability.effort?.length) {
    states.push({ label: capability.availability === "always" ? "ALWAYS ON" : "ON", enabled: true });
  } else {
    states.push({ label: "AUTO", enabled: true });
    for (const effort of capability.effort) states.push({ label: effort, enabled: true, effort });
  }
  return states;
}
export function cycleThinkingState(states: ThinkingState[], current: ThinkingPreference, direction: -1 | 1): ThinkingState | undefined {
  if (states.length <= 1) return states[0];
  const index = Math.max(0, states.findIndex((state) => state.enabled === current.enabled && state.effort === current.effort));
  return states[(index + direction + states.length) % states.length];
}
