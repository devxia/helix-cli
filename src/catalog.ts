import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProviderType, ModelDef } from "./config.js";

// ---------------------------------------------------------------------------
// Catalog types (from models.dev/api.json)
// ---------------------------------------------------------------------------

export interface CatalogModel {
  id: string;
  name: string;
  family?: string;
  attachment: boolean;
  reasoning: boolean;
  tool_call: boolean;
  temperature?: boolean;
  structured_output?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  modalities: {
    input: string[];
    output: string[];
  };
  open_weights?: boolean;
  limit: {
    context: number;
    output: number;
    input?: number;
  };
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  status?: string;
  reasoning_options?: Array<
    | { type: "toggle" }
    | { type: "effort"; values: string[] }
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

// ---------------------------------------------------------------------------
// Known base URLs for SDK-managed providers (no `api` field in models.dev)
// ---------------------------------------------------------------------------

const SDK_BASE_URLS: Record<string, { url: string; type: ProviderType }> = {
  openai:                    { url: "https://api.openai.com/v1",              type: "openai" },
  anthropic:                 { url: "https://api.anthropic.com",              type: "anthropic" },
  google:                    { url: "https://generativelanguage.googleapis.com", type: "google-genai" },
  google_vertex:             { url: "https://aiplatform.googleapis.com",      type: "vertexai" },
  google_vertex_anthropic:   { url: "https://aiplatform.googleapis.com",      type: "vertexai" },
  mistral:                   { url: "https://api.mistral.ai/v1",             type: "openai" },
  xai:                       { url: "https://api.x.ai/v1",                  type: "openai" },
  groq:                      { url: "https://api.groq.com/openai/v1",        type: "openai" },
  cerebras:                  { url: "https://api.cerebras.ai/v1",            type: "openai" },
  deepinfra:                 { url: "https://api.deepinfra.com/v1/openai",   type: "openai" },
  togetherai:                { url: "https://api.together.xyz/v1",           type: "openai" },
  perplexity:                { url: "https://api.perplexity.ai",             type: "openai" },
  cohere:                    { url: "https://api.cohere.com/v2",             type: "openai" },
  github_copilot:            { url: "https://api.githubcopilot.com",         type: "openai" },
  github_models:             { url: "https://models.github.ai/inference",    type: "openai" },
};

// ---------------------------------------------------------------------------
// Infer provider type from catalog entry
// ---------------------------------------------------------------------------

export function inferProviderType(entry: CatalogEntry): ProviderType | undefined {
  // Explicit SDK-managed providers
  const sdkKey = entry.id.replace(/-/g, "_");
  if (SDK_BASE_URLS[sdkKey]) return SDK_BASE_URLS[sdkKey].type;

  // If it has an `api` field, it's OpenAI-compatible
  if (entry.api) return "openai";

  // Check npm field for clues
  if (entry.npm?.includes("anthropic")) return "anthropic";
  if (entry.npm?.includes("google")) return "google-genai";

  // Default: assume OpenAI-compatible if there's an api field
  return undefined;
}

// ---------------------------------------------------------------------------
// Derive base URL for a catalog entry
// ---------------------------------------------------------------------------

export function catalogBaseUrl(entry: CatalogEntry, type: ProviderType): string {
  // SDK-managed: use known URL
  const sdkKey = entry.id.replace(/-/g, "_");
  if (SDK_BASE_URLS[sdkKey]) return SDK_BASE_URLS[sdkKey].url;

  // Has explicit api field
  if (entry.api) return entry.api;

  // Fallback
  return "";
}

// ---------------------------------------------------------------------------
// Extract models as ModelDef[]
// ---------------------------------------------------------------------------

export function catalogModels(entry: CatalogEntry): ModelDef[] {
  return Object.values(entry.models)
    .filter((m) => !m.status || m.status !== "deprecated")
    .map((m) => ({
      id: m.id,
      label: m.name || m.id,
      description: buildModelDescription(m),
      reasoning: m.reasoning,
    }));
}

function buildModelDescription(m: CatalogModel): string {
  const parts: string[] = [];
  if (m.reasoning) parts.push("thinking");
  if (m.tool_call) parts.push("tools");
  if (m.attachment) parts.push("vision");
  if (m.limit?.context) {
    const ctx = m.limit.context;
    parts.push(ctx >= 1_000_000 ? `${(ctx / 1_000_000).toFixed(0)}M ctx` : `${(ctx / 1000).toFixed(0)}K ctx`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Catalog fetching with disk cache
// ---------------------------------------------------------------------------

const CATALOG_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cachePath(): string {
  return path.join(os.homedir(), ".helix", "catalog_cache.json");
}

function ensureConfigDir(): void {
  const dir = path.join(os.homedir(), ".helix");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCacheFromDisk(): { data: Catalog; timestamp: number } | null {
  const file = cachePath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCacheToDisk(data: Catalog): void {
  ensureConfigDir();
  const file = cachePath();
  const payload = JSON.stringify({ data, timestamp: Date.now() });
  fs.writeFileSync(file, payload, "utf-8");
  fs.chmodSync(file, 0o600);
}

/**
 * Fetch the provider catalog from models.dev.
 * Returns a Map of provider ID → CatalogEntry, sorted by name.
 * Uses disk cache with 1-hour TTL; falls back to cache on network error.
 */
export async function fetchCatalog(signal?: AbortSignal): Promise<Map<string, CatalogEntry>> {
  // Try network first
  try {
    const res = await fetch(CATALOG_URL, {
      signal,
      headers: { "User-Agent": "HelixCLI/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Catalog;
    saveCacheToDisk(data);
    return sortCatalog(data);
  } catch {
    // Network failed — try disk cache
    const cached = loadCacheFromDisk();
    if (cached) return sortCatalog(cached.data);
    return new Map();
  }
}

/**
 * Load catalog from disk cache only (no network).
 * Returns empty map if no cache exists.
 */
export function loadCatalogFromCache(): Map<string, CatalogEntry> {
  const cached = loadCacheFromDisk();
  if (!cached) return new Map();
  // Check TTL
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) return new Map();
  return sortCatalog(cached.data);
}

function sortCatalog(data: Catalog): Map<string, CatalogEntry> {
  const entries = Object.entries(data)
    .filter(([, e]) => {
      // Only include providers we can handle
      const type = inferProviderType(e);
      return type !== undefined;
    })
    .sort(([, a], [, b]) => (a.name || a.id).localeCompare(b.name || b.id));
  return new Map(entries);
}

/**
 * Pre-populate model cache from catalog disk cache.
 * This runs at startup so /model has models ready before network fetch.
 * Returns the model data keyed by provider ID.
 */
export async function preloadCatalogModels(): Promise<Map<string, ModelDef[]>> {
  const result = new Map<string, ModelDef[]>();
  const cached = loadCacheFromDisk();
  if (!cached) return result;

  for (const [id, entry] of Object.entries(cached.data)) {
    const type = inferProviderType(entry);
    if (!type) continue;
    const models = catalogModels(entry);
    if (models.length > 0) {
      result.set(id, models);
    }
  }

  // Trigger network refresh in background (fire-and-forget)
  fetchCatalog().catch(() => {});

  return result;
}
