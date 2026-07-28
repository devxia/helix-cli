import { describe, expect, test } from "bun:test";
import { catalogModels, deriveReasoningCapability, inferProviderType, isAdaptiveClaudeModel, sortCatalog, type CatalogEntry, type CatalogModel } from "../src/catalog.js";

function model(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: "m", name: "Model", attachment: false, reasoning: true, tool_call: false,
    modalities: { input: ["text"], output: ["text"] }, limit: { context: 128000, output: 4096 },
    ...overrides,
  };
}
function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id: "vendor", name: "Vendor", api: "https://example.test/v1", models: { m: model() }, ...overrides };
}

describe("catalog protocol and model mapping", () => {
  test("npm-native protocol wins over API URL", () => {
    expect(inferProviderType(entry({ id: "kimi-for-coding", npm: "@ai-sdk/anthropic" }))).toBe("anthropic");
    expect(inferProviderType(entry({ id: "minimax", npm: "@ai-sdk/anthropic" }))).toBe("anthropic");
  });

  test("only representable audited providers are exposed", () => {
    expect(inferProviderType(entry({ id: "xai", api: undefined, npm: "@ai-sdk/xai", env: ["XAI_API_KEY"] }))).toBe("openai");
    expect(inferProviderType(entry({ id: "deepinfra", api: undefined, npm: "@ai-sdk/deepinfra", env: ["DEEPINFRA_API_KEY"] }))).toBe("openai");
    expect(inferProviderType(entry({ id: "cloudflare-workers-ai", api: "https://api.cloudflare.com/accounts/${ACCOUNT}/ai/v1", npm: "@ai-sdk/openai-compatible", env: ["ACCOUNT", "TOKEN"] }))).toBeUndefined();
    expect(inferProviderType(entry({ id: "databricks", api: "https://${HOST}/v1", npm: "@ai-sdk/openai-compatible", env: ["HOST", "TOKEN"] }))).toBeUndefined();
    expect(inferProviderType(entry({ id: "unknown-vendor", npm: "@ai-sdk/vendor" }))).toBeUndefined();
  });

  test("unsupported Vertex Anthropic is hidden and Vertex Claude models are filtered", () => {
    const unsupported = entry({ id: "google-vertex-anthropic", npm: "@ai-sdk/anthropic" });
    expect(inferProviderType(unsupported)).toBeUndefined();
    expect(sortCatalog({ [unsupported.id]: unsupported }).size).toBe(0);
    const vertex = entry({
      id: "google-vertex", api: undefined,
      models: {
        gemini: model({ id: "gemini-2.5-pro" }),
        claude: model({ id: "claude-sonnet-4-5@20250929", family: "claude" }),
      },
    });
    expect(catalogModels(vertex).map((item) => item.id)).toEqual(["gemini-2.5-pro"]);
  });

  test("native effort and context survive while budgets are not invented as effort", () => {
    const effort = model({ reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }] });
    expect(deriveReasoningCapability("moonshotai-cn", effort)).toEqual({ availability: "toggle", persistence: "none", effort: ["low", "high", "max"] });
    expect(deriveReasoningCapability("moonshotai-cn", { ...effort, id: "kimi-k3" })).toEqual({ availability: "always", persistence: "required", effort: ["low", "high", "max"] });
    expect(deriveReasoningCapability("moonshotai-cn", { ...effort, id: "kimi-k2.7-code" })).toEqual({ availability: "always", persistence: "required" });
    expect(deriveReasoningCapability("moonshotai-cn", { ...effort, id: "kimi-k2.5" })).toEqual({ availability: "toggle", persistence: "none" });
    const budget = model({ reasoning_options: [{ type: "budget_tokens", min: 0, max: 32000 }] });
    expect(deriveReasoningCapability("google", budget)).toEqual({ availability: "always", persistence: "none", effort: undefined });
    expect(catalogModels(entry({ models: { m: effort } }))[0]?.context).toBe(128000);
  });

  test("Anthropic controls are visible only for parseable Claude 4.6+", () => {
    expect(isAdaptiveClaudeModel("claude-sonnet-4-6-20260101")).toBe(true);
    expect(isAdaptiveClaudeModel("claude-haiku-4-5-20251001")).toBe(false);
    expect(deriveReasoningCapability("anthropic", model({ id: "claude-haiku-4-5" })).availability).toBe("none");
    expect(deriveReasoningCapability("anthropic", model({ id: "claude-opus-4-6" })).availability).toBe("always");
  });

  test("Anthropic-wire non-native providers do not guess Claude controls", () => {
    const advertised = model({ reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "max"] }] });
    expect(deriveReasoningCapability("kimi-for-coding", advertised)).toEqual({ availability: "always", persistence: "none" });
    expect(deriveReasoningCapability("minimax", advertised)).toEqual({ availability: "always", persistence: "none" });
  });
});
