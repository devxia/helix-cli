import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HelixSettingsStorage } from "../src/settings-storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Helix settings isolation", () => {
  test("strips package/resource discovery and telemetry on every read and write", async () => {
    const root = await mkdtemp(join(tmpdir(), "helix-settings-test-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "project");
    const agentDir = join(root, ".helix");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      theme: "light",
      packages: ["npm:untrusted"],
      extensions: ["./extension.ts"],
      enableAnalytics: true,
      enableInstallTelemetry: true,
    }));

    const storage = new HelixSettingsStorage(cwd, agentDir);
    storage.withLock("global", (current) => {
      const settings = JSON.parse(current!);
      expect(settings).toMatchObject({
        theme: "light",
        packages: [],
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
        enableAnalytics: false,
        enableInstallTelemetry: false,
      });
      settings.packages = ["npm:still-untrusted"];
      settings.enableAnalytics = true;
      return JSON.stringify(settings);
    });

    const persisted = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"));
    expect(persisted.packages).toEqual([]);
    expect(persisted.enableAnalytics).toBeFalse();
    expect(persisted.theme).toBe("light");
    expect(await Bun.file(join(agentDir, "settings.json.lock")).exists()).toBeFalse();
    expect(await Bun.file(join(cwd, ".pi", "settings.json")).exists()).toBeFalse();
  });
});
