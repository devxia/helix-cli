import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  defaultConfig,
  getAvailableModels,
  invalidateConfigCache,
  loadConfig,
  mergeLiveWithCatalog,
  migrateLegacyConfig,
  refreshProviderModels,
  resolveCredentials,
  resolveThinkingPreference,
  saveConfig,
  setCatalogProviderModels,
  setConfigHomeForTests,
  setProvider,
  setThinkingPreference,
  thinkingStates,
  cycleThinkingState,
  type ModelDef,
  type ProviderConfig,
} from "../src/config.js";

let temp: string | undefined;
afterEach(() => {
  setConfigHomeForTests(undefined);
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});
function useTemp(): string {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "helix-test-"));
  setConfigHomeForTests(temp);
  return temp;
}
const toggle: ModelDef = { id: "reasoner", label: "Reasoner", reasoning: { availability: "toggle", persistence: "none", effort: ["low", "high"] }, context: 8000 };

describe("config migration", () => {
  test("fresh config is empty", () => {
    expect(defaultConfig()).toEqual({ providers: {}, thinking_preferences: {} });
    expect(migrateLegacyConfig({ providers: {} }).config).toEqual(defaultConfig());
  });

  test("old mirror keeps only active/keyed providers and canonicalizes Kimi Code", () => {
    const result = migrateLegacyConfig({
      active_provider: "kimi-code", active_model: "kimi-for-coding", thinking: true,
      providers: {
        kimi: { name: "Kimi", type: "openai", base_url: "https://api.moonshot.cn/v1", api_key: "" },
        "kimi-code": { name: "Kimi Code", type: "openai", base_url: "https://api.kimi.com/coding/v1", api_key: "secret" },
        openai: { name: "OpenAI", type: "openai", base_url: "https://api.openai.com/v1", api_key: "" },
      },
    }).config;
    expect(Object.keys(result.providers)).toEqual(["kimi-for-coding"]);
    expect(result.providers["kimi-for-coding"]?.type).toBe("anthropic");
    expect(result.providers["kimi-for-coding"]?.api_key).toBe("secret");
    expect(result.active_provider).toBe("kimi-for-coding");
    expect(result.legacy_thinking).toBeUndefined();
  });

  test("canonical facts match current MiniMax, SiliconFlow CN, and Google catalog", () => {
    const minimax = migrateLegacyConfig({ active_provider: "minimax", providers: { minimax: { name: "MiniMax", type: "openai", base_url: "https://api.minimax.chat/v1", api_key: "mini" } } }).config;
    expect(minimax.providers.minimax).toMatchObject({ name: "MiniMax (minimax.io)", type: "anthropic", base_url: "https://api.minimax.io/anthropic/v1", api_key: "mini" });
    const silicon = migrateLegacyConfig({ active_provider: "siliconflow", providers: { siliconflow: { name: "SiliconFlow", type: "openai", base_url: "https://api.siliconflow.cn/v1", api_key: "sf" } } }).config;
    expect(silicon.active_provider).toBe("siliconflow-cn");
    expect(silicon.providers["siliconflow-cn"]?.env).toEqual(["SILICONFLOW_CN_API_KEY"]);
    const globalSilicon = migrateLegacyConfig({ active_provider: "siliconflow", providers: { siliconflow: { name: "SiliconFlow", type: "openai", base_url: "https://api.siliconflow.com/v1", api_key: "global" } } }).config;
    expect(globalSilicon.active_provider).toBe("siliconflow");
    expect(globalSilicon.providers.siliconflow?.env).toEqual(["SILICONFLOW_API_KEY"]);
    const google = migrateLegacyConfig({ active_provider: "google-genai", providers: { "google-genai": { name: "Google", type: "google-genai", base_url: "https://generativelanguage.googleapis.com", api_key: "g" } } }).config;
    expect(google.providers.google?.env).toEqual(["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"]);
  });

  test("mixed alias/canonical collisions merge safely or retain conflicting keys as Custom", () => {
    const merged = migrateLegacyConfig({
      active_provider: "moonshotai-cn",
      providers: {
        kimi: { name: "Kimi", type: "openai", base_url: "https://api.moonshot.cn/v1", api_key: "" },
        "moonshotai-cn": { name: "Moonshot", type: "openai", source: "catalog", base_url: "https://api.moonshot.cn/v1", api_key: "canonical-key", env: ["MOONSHOT_API_KEY"] },
      },
    }).config;
    expect(Object.keys(merged.providers)).toEqual(["moonshotai-cn"]);
    expect(merged.providers["moonshotai-cn"]?.api_key).toBe("canonical-key");

    const conflicting = migrateLegacyConfig({
      active_provider: "kimi",
      providers: {
        "moonshotai-cn": { name: "Moonshot", type: "openai", source: "catalog", base_url: "https://api.moonshot.cn/v1", api_key: "canonical-key", env: ["MOONSHOT_API_KEY"] },
        kimi: { name: "Kimi", type: "openai", base_url: "https://api.moonshot.cn/v1", api_key: "active-key" },
      },
    }).config;
    expect(conflicting.active_provider).toBe("moonshotai-cn");
    expect(conflicting.providers["moonshotai-cn"]?.api_key).toBe("active-key");
    const retained = Object.entries(conflicting.providers).find(([id]) => id.startsWith("custom-"));
    expect(retained?.[1].api_key).toBe("canonical-key");
  });

  test("modified, missing-catalog, and unsupported-wire legacy providers become Custom", () => {
    const modified = migrateLegacyConfig({ active_provider: "kimi", providers: { kimi: { name: "Lab", type: "openai", base_url: "https://lab.test/v1", api_key: "k" } } }).config;
    const [id] = Object.keys(modified.providers);
    expect(id?.startsWith("custom-")).toBe(true);
    expect(modified.providers[id!]?.base_url).toBe("https://lab.test/v1");
    const missing = migrateLegacyConfig({ active_provider: "yi", providers: { yi: { name: "Yi", type: "openai", base_url: "https://api.lingyiwanwu.com/v1", api_key: "" } } }).config;
    expect(Object.values(missing.providers)[0]?.source).toBe("custom");
    const cohere = migrateLegacyConfig({ active_provider: "cohere", providers: { cohere: { name: "Cohere", type: "openai", base_url: "https://api.cohere.com/v2", api_key: "c" } } }).config;
    expect(cohere.active_provider?.startsWith("custom-")).toBe(true);
    expect(Object.values(cohere.providers)[0]).toMatchObject({ source: "custom", api_key: "c" });
  });

  test("unsupported Responses configuration fails closed instead of silently changing protocols", () => {
    expect(() => migrateLegacyConfig({
      active_provider: "lab",
      providers: { lab: { name: "Lab", type: "openai_responses", base_url: "https://lab.test/v1", api_key: "secret" } },
    })).toThrow("Unsupported legacy provider protocol");
  });
});

describe("credentials and Thinking", () => {
  test("catalog reads only declared env; custom reads only local key; Vertex needs project/location, not API key", () => {
    const catalog: ProviderConfig = { name: "X", type: "openai", source: "catalog", base_url: "x", api_key: "local", env: ["RIGHT_KEY"] };
    expect(resolveCredentials(catalog, { LEGACY_KEY: "wrong", RIGHT_KEY: "right" })).toEqual({ kind: "api-key", apiKey: "right" });
    const custom: ProviderConfig = { ...catalog, source: "custom", api_key: "local" };
    expect(resolveCredentials(custom, { RIGHT_KEY: "env" })).toEqual({ kind: "api-key", apiKey: "local" });
    const vertex: ProviderConfig = { name: "Vertex", type: "vertexai", source: "catalog", base_url: "", api_key: "fake", env: [] };
    expect(resolveCredentials(vertex, { GOOGLE_VERTEX_PROJECT: "p", GOOGLE_VERTEX_LOCATION: "us" })).toEqual({ kind: "vertex", project: "p", location: "us" });
    expect(resolveCredentials(vertex, { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key" })).toEqual({ kind: "missing" });
  });

  test("capable models default ON/AUTO and adaptive states preserve native order", () => {
    useTemp();
    saveConfig({ active_provider: "p", active_model: toggle.id, providers: { p: { name: "P", type: "openai", source: "custom", base_url: "x", api_key: "k" } }, thinking_preferences: {} });
    setCatalogProviderModels("p", [toggle]);
    expect(resolveThinkingPreference("p", toggle)).toEqual({ enabled: true });
    const states = thinkingStates(toggle.reasoning);
    expect(states.map((state) => state.label)).toEqual(["OFF", "AUTO", "low", "high"]);
    expect(cycleThinkingState(states, { enabled: true }, 1)?.label).toBe("low");
    setThinkingPreference("p", toggle, { enabled: false });
    expect(resolveThinkingPreference("p", toggle)).toEqual({ enabled: false, effort: undefined });
  });

  test("empty-key reselection preserves stored key and the same active model", () => {
    useTemp();
    saveConfig({ active_provider: "p", active_model: "chosen", providers: { p: { name: "P", type: "openai", source: "catalog", base_url: "x", api_key: "stored", env: ["P_KEY"] } }, thinking_preferences: {} });
    setCatalogProviderModels("p", [toggle, { id: "chosen", label: "Chosen", reasoning: { availability: "none", persistence: "none" } }]);
    const result = setProvider("p", "");
    expect(result.providers.p?.api_key).toBe("stored");
    expect(result.active_model).toBe("chosen");
  });

  test("legacy false migrates only current toggle model", () => {
    useTemp();
    saveConfig({ active_provider: "p", active_model: toggle.id, providers: { p: { name: "P", type: "openai", source: "custom", base_url: "x", api_key: "k" } }, thinking_preferences: {}, legacy_thinking: false });
    setCatalogProviderModels("p", [toggle]);
    expect(resolveThinkingPreference("p", toggle).enabled).toBe(false);
  });

  test("unknown live metadata postpones legacy Thinking migration until authoritative toggle arrives", () => {
    useTemp();
    saveConfig({ active_provider: "p", active_model: toggle.id, providers: { p: { name: "P", type: "openai", source: "custom", base_url: "x", api_key: "k" } }, thinking_preferences: {}, legacy_thinking: false });
    const unknown: ModelDef = { id: toggle.id, label: toggle.label, reasoning: { availability: "none", persistence: "none" }, reasoningKnown: false };
    expect(resolveThinkingPreference("p", unknown)).toEqual({ enabled: false });
    expect(loadConfig().legacy_thinking).toBe(false);
    expect(resolveThinkingPreference("p", { ...toggle, reasoningKnown: true })).toEqual({ enabled: false, effort: undefined });
    expect(loadConfig().legacy_thinking).toBeUndefined();
  });

  test("quoted provider/model IDs and preferences round-trip with private permissions", () => {
    const home = useTemp();
    const providerId = "lab.provider/slash";
    const modelId = "model.\"quoted/slash";
    saveConfig({
      active_provider: providerId,
      active_model: modelId,
      providers: { [providerId]: { name: "Lab", type: "openai", source: "custom", base_url: "https://lab.test", api_key: "not-real" } },
      thinking_preferences: { [providerId]: { [modelId]: { enabled: true, effort: "native-high" } } },
    });
    invalidateConfigCache();
    expect(loadConfig().thinking_preferences[providerId]?.[modelId]).toEqual({ enabled: true, effort: "native-high" });
    expect(fs.statSync(path.join(home, ".helix", "config.toml")).mode & 0o777).toBe(0o600);
  });
});

describe("live model snapshot semantics", () => {
  test("live membership wins and catalog only enriches matching IDs", () => {
    const none = { availability: "none", persistence: "none" } as const;
    const result = mergeLiveWithCatalog(
      [{ id: "A", label: "A", reasoning: none }, { id: "B", label: "B", reasoning: none }],
      [{ id: "B", label: "Bee", reasoning: toggle.reasoning }, { id: "C", label: "C", reasoning: none }],
    );
    expect(result.map((model) => model.id)).toEqual(["A", "B"]);
    expect(result[1]?.label).toBe("Bee");
  });

  test("fresh snapshots avoid network and preserve live membership", async () => {
    const home = useTemp();
    saveConfig({ active_provider: "p", active_model: "A", providers: { p: { name: "P", type: "openai", source: "custom", base_url: "https://example.test/v1", api_key: "k" } }, thinking_preferences: {} });
    fs.writeFileSync(path.join(home, ".helix", "models_cache.toml"), `["p"]\nsource = "live"\nfetched_at = 1000\nmodels = [{ id = "A", label = "A", reasoning_known = true, reasoning = { availability = "none", persistence = "none" } }]\n`);
    setConfigHomeForTests(home);
    let calls = 0;
    const result = await refreshProviderModels("p", { now: () => 1100, fetchFn: (async () => { calls++; return new Response(); }) as typeof fetch });
    expect(calls).toBe(0);
    expect(result.map((model) => model.id)).toEqual(["A"]);
  });

  test("concurrent missing-snapshot refreshes deduplicate and persist live IDs", async () => {
    useTemp();
    saveConfig({ active_provider: "p", active_model: "A", providers: { p: { name: "P", type: "openai", source: "custom", base_url: "https://example.test/v1", api_key: "k" } }, thinking_preferences: {} });
    setCatalogProviderModels("p", [toggle, { id: "A", label: "Alpha", reasoning: { availability: "none", persistence: "none" } }]);
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      await Bun.sleep(5);
      return new Response(JSON.stringify({ data: [{ id: "A" }, { id: "B" }] }), { status: 200 });
    }) as typeof fetch;
    const [first, second] = await Promise.all([refreshProviderModels("p", { fetchFn: fakeFetch, now: () => 100 }), refreshProviderModels("p", { fetchFn: fakeFetch, now: () => 100 })]);
    expect(calls).toBe(1);
    expect(first.map((model) => model.id)).toEqual(["A", "B"]);
    expect(second.map((model) => model.id)).toEqual(["A", "B"]);
    expect(getAvailableModels("p")[0]?.label).toBe("Alpha");
    const cache = fs.readFileSync(path.join(temp!, ".helix", "models_cache.toml"), "utf-8");
    expect(cache).toContain('source = "live"');
    expect(cache).toContain('availability = "none"');
    expect(cache).toContain("reasoning_known = true");
    expect(cache).not.toContain("models_cache.json");
    setConfigHomeForTests(temp);
    expect(getAvailableModels("p")[0]).toMatchObject({ id: "A", label: "Alpha", reasoning: { availability: "none", persistence: "none" } });
  });

  test("ambiguous legacy TOML arrays are ignored rather than labelled live", async () => {
    const home = useTemp();
    saveConfig({ active_provider: "p", active_model: "old", providers: { p: { name: "P", type: "openai", source: "custom", base_url: "https://example.test/v1", api_key: "k" } }, thinking_preferences: {} });
    fs.writeFileSync(path.join(home, ".helix", "models_cache.toml"), `[p]\nmodels = [{ id = "old", label = "Old" }]\n`);
    setConfigHomeForTests(home);
    let calls = 0;
    const result = await refreshProviderModels("p", { fetchFn: (async () => { calls++; return new Response(JSON.stringify({ data: [{ id: "live" }] }), { status: 200 }); }) as typeof fetch });
    expect(calls).toBe(1);
    expect(result.map((model) => model.id)).toEqual(["live"]);
  });
});
