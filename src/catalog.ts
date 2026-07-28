import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProviderType, ModelDef, ReasoningCapability } from "./config.js";

export interface CatalogModel {
  id: string;
  name: string;
  family?: string;
  attachment: boolean;
  reasoning: boolean;
  tool_call: boolean;
  temperature?: boolean;
  structured_output?: boolean;
  modalities: { input: string[]; output: string[] };
  limit: { context: number; output: number; input?: number };
  status?: string;
  reasoning_options?: Array<
    | { type: "toggle" }
    | { type: "effort"; values: string[] }
    | { type: "budget_tokens"; min?: number; max?: number }
  >;
}
export interface CatalogEntry {
  id: string;
  name: string;
  api?: string;
  env?: string[];
  npm?: string;
  doc?: string;
  models: Record<string, CatalogModel>;
}
export type Catalog = Record<string, CatalogEntry>;

const NATIVE_PROVIDERS: Record<string, { url: string; type: ProviderType }> = {
  openai: { url: "https://api.openai.com/v1", type: "openai" },
  anthropic: { url: "https://api.anthropic.com", type: "anthropic" },
  google: { url: "https://generativelanguage.googleapis.com", type: "google-genai" },
  "google-vertex": { url: "https://aiplatform.googleapis.com", type: "vertexai" },
  minimax: { url: "https://api.minimax.io/anthropic/v1", type: "anthropic" },
  "kimi-for-coding": { url: "https://api.kimi.com/coding/v1", type: "anthropic" },
};

/** Audited OpenAI Chat Completions endpoints for protocols Helix implements. */
const OPENAI_WIRE_ENDPOINTS: Record<string, string> = {
  "moonshotai-cn": "https://api.moonshot.cn/v1",
  moonshotai: "https://api.moonshot.ai/v1",
  deepseek: "https://api.deepseek.com",
  "siliconflow-cn": "https://api.siliconflow.cn/v1",
  siliconflow: "https://api.siliconflow.com/v1",
  "alibaba-cn": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  zhipuai: "https://open.bigmodel.cn/api/paas/v4",
  "fireworks-ai": "https://api.fireworks.ai/inference/v1",
  mistral: "https://api.mistral.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  togetherai: "https://api.together.xyz/v1",
  openrouter: "https://openrouter.ai/api/v1",
  perplexity: "https://api.perplexity.ai",
  deepinfra: "https://api.deepinfra.com/v1/openai",
  cerebras: "https://api.cerebras.ai/v1",
};

export function inferProviderType(entry: CatalogEntry): ProviderType | undefined {
  if (entry.id === "google-vertex-anthropic") return undefined;
  const native = NATIVE_PROVIDERS[entry.id];
  if (native) return native.type;
  if (!OPENAI_WIRE_ENDPOINTS[entry.id]) return undefined;
  // Bearer-key OpenAI connections cannot represent templated endpoints or
  // multiple structured credential fields.
  if (entry.api?.includes("${") || (entry.env?.length ?? 0) > 1) return undefined;
  return "openai";
}

export function catalogBaseUrl(entry: CatalogEntry, _type: ProviderType): string {
  return NATIVE_PROVIDERS[entry.id]?.url ?? OPENAI_WIRE_ENDPOINTS[entry.id] ?? "";
}

export function isAdaptiveClaudeModel(modelId: string): boolean {
  const match = modelId.toLowerCase().match(/(?:claude-)?(?:opus|sonnet|haiku)[-_ ]?(\d+)[-_.](\d+)(?:\D|$)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 4 || (major === 4 && minor >= 6);
}

export type MoonshotReasoningMode = "k3" | "always" | "toggle";
export function moonshotReasoningMode(modelId: string): MoonshotReasoningMode | undefined {
  const id = modelId.toLowerCase();
  if (/(?:^|[-_])(?:kimi-)?k3(?:$|[-_.])/.test(id)) return "k3";
  if (/(?:^|[-_])(?:kimi-)?k2[._-]?7(?:$|[-_.])/.test(id)) return "always";
  if (/(?:^|[-_])(?:kimi-)?k2[._-]?(?:5|6)(?:$|[-_.])/.test(id)) return "toggle";
  return undefined;
}

export function deriveReasoningCapability(providerId: string, model: CatalogModel): ReasoningCapability {
  if (!model.reasoning) return { availability: "none", persistence: "none" };
  if (providerId === "anthropic" && !isAdaptiveClaudeModel(model.id)) {
    return { availability: "none", persistence: "none" };
  }
  // These providers share Anthropic wire framing, but Helix has no authoritative
  // toggle/effort mapping for them. Do not send Claude-specific controls.
  if (providerId === "kimi-for-coding" || providerId === "minimax") {
    return { availability: "always", persistence: "none" };
  }
  const catalogEffort = model.reasoning_options?.find((option): option is { type: "effort"; values: string[] } => option.type === "effort")?.values;
  if (providerId === "moonshotai" || providerId === "moonshotai-cn") {
    const mode = moonshotReasoningMode(model.id);
    if (mode === "k3") return { availability: "always", persistence: "required", effort: catalogEffort?.length ? [...catalogEffort] : undefined };
    if (mode === "always") return { availability: "always", persistence: "required" };
    if (mode === "toggle") return { availability: "toggle", persistence: "none" };
  }
  const availability = model.reasoning_options?.some((option) => option.type === "toggle") ? "toggle" : "always";
  return { availability, persistence: "none", effort: catalogEffort?.length ? [...catalogEffort] : undefined };
}

export function catalogModels(entry: CatalogEntry): ModelDef[] {
  return Object.values(entry.models)
    .filter((model) => !model.status || model.status !== "deprecated")
    .filter((model) => entry.id !== "google-vertex" || (!model.id.toLowerCase().startsWith("claude-") && !model.family?.toLowerCase().startsWith("claude")))
    .map((model) => ({
      id: model.id,
      label: model.name || model.id,
      description: buildDescription(model),
      reasoning: deriveReasoningCapability(entry.id, model),
      reasoningKnown: true,
      context: model.limit?.context,
      output: model.limit?.output,
    }));
}

function buildDescription(model: CatalogModel): string {
  const parts: string[] = [];
  if (model.reasoning) parts.push("thinking");
  if (model.attachment) parts.push("vision");
  if (model.limit?.context) {
    const context = model.limit.context;
    parts.push(context >= 1_000_000 ? `${context / 1_000_000}M ctx` : `${Math.round(context / 1000)}K ctx`);
  }
  return parts.join(" · ");
}

const CATALOG_URL = "https://models.dev/api.json";
const TTL = 60 * 60 * 1000;
let refreshInFlight: Promise<Map<string, CatalogEntry>> | null = null;
function cachePath(): string { return path.join(os.homedir(), ".helix", "catalog_cache.json"); }
function loadDisk(): { data: Catalog; timestamp: number } | null {
  try { return JSON.parse(fs.readFileSync(cachePath(), "utf-8")); } catch { return null; }
}
function saveDisk(data: Catalog): void {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify({ data, timestamp: Date.now() }), { encoding: "utf-8", mode: 0o600 });
  fs.chmodSync(cachePath(), 0o600);
}
export function sortCatalog(data: Catalog): Map<string, CatalogEntry> {
  return new Map(Object.entries(data)
    .filter(([, entry]) => inferProviderType(entry) !== undefined)
    .sort(([, a], [, b]) => (a.name || a.id).localeCompare(b.name || b.id)));
}
async function refreshCatalog(signal?: AbortSignal): Promise<Map<string, CatalogEntry>> {
  const response = await fetch(CATALOG_URL, { signal, headers: { "User-Agent": "HelixCLI/1.5" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as Catalog;
  saveDisk(data);
  return sortCatalog(data);
}
export async function fetchCatalog(signal?: AbortSignal): Promise<Map<string, CatalogEntry>> {
  const cached = loadDisk();
  if (cached && Date.now() - cached.timestamp < TTL) return sortCatalog(cached.data);
  if (cached) {
    if (!refreshInFlight) refreshInFlight = refreshCatalog().finally(() => { refreshInFlight = null; });
    void refreshInFlight.catch(() => {});
    return sortCatalog(cached.data);
  }
  if (!refreshInFlight) refreshInFlight = refreshCatalog(signal).finally(() => { refreshInFlight = null; });
  try { return await refreshInFlight; } catch { return new Map(); }
}
export function loadCatalogFromCache(): Map<string, CatalogEntry> {
  const cached = loadDisk();
  return cached ? sortCatalog(cached.data) : new Map();
}
export async function preloadCatalogModels(): Promise<Map<string, ModelDef[]>> {
  const result = new Map<string, ModelDef[]>();
  for (const [id, entry] of loadCatalogFromCache()) {
    const models = catalogModels(entry);
    if (models.length) result.set(id, models);
  }
  void fetchCatalog().catch(() => {});
  return result;
}
