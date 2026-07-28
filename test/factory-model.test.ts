import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { googleClientOptions } from "../src/llm/factory.js";
import { buildModelChoices, buildModelTabs, thinkingPreview } from "../src/commands/model.js";
import { saveConfig, setCatalogProviderModels, setConfigHomeForTests, type ProviderConfig } from "../src/config.js";

let temp: string | undefined;
afterEach(() => {
  setConfigHomeForTests(undefined);
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
});

describe("factory and immutable provider-aware choices", () => {
  test("Vertex options omit API key and carry project/location", () => {
    const vertex: ProviderConfig = { name: "Vertex", type: "vertexai", source: "catalog", base_url: "", api_key: "fake", env: [] };
    expect(googleClientOptions(vertex, { kind: "vertex", project: "project", location: "us-central1" })).toEqual({ vertexai: true, project: "project", location: "us-central1" });
    const google: ProviderConfig = { name: "Google", type: "google-genai", source: "catalog", base_url: "", api_key: "", env: [] };
    expect(googleClientOptions(google, { kind: "api-key", apiKey: "key" })).toEqual({ apiKey: "key" });
  });

  test("duplicate model IDs remain unambiguous by provider+model identity", () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "helix-choice-"));
    setConfigHomeForTests(temp);
    const providers: Record<string, ProviderConfig> = {
      a: { name: "A", type: "openai", source: "custom", base_url: "a", api_key: "ka" },
      b: { name: "B", type: "openai", source: "custom", base_url: "b", api_key: "kb" },
    };
    saveConfig({ active_provider: "a", active_model: "same", providers, thinking_preferences: {} });
    const model = { id: "same", label: "Same", reasoning: { availability: "none", persistence: "none" } } as const;
    setCatalogProviderModels("a", [model]);
    setCatalogProviderModels("b", [model]);
    const choices = buildModelChoices(providers);
    expect(choices.map((choice) => choice.key)).toEqual(["a\u0000same", "b\u0000same"]);
    expect(new Set(choices.map((choice) => choice.key)).size).toBe(2);
    expect(buildModelTabs(choices).map((tab) => tab.id)).toEqual(["__all__", "a", "b"]);
  });

  test("Thinking preview renders every legal native state in order", () => {
    const preview = thinkingPreview(
      { availability: "toggle", persistence: "none", effort: ["low", "high", "max"] },
      { enabled: true, effort: "high" },
    );
    expect(preview).toBe("○ OFF │ ○ AUTO │ ○ low │ ◉ high │ ○ max");
  });
});
