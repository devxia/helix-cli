import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHelixPaths } from "../src/paths.js";
import { configurePiEnvironment, preparePiRuntimeAssets } from "../src/runtime-assets.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("isolated Helix runtime", () => {
  test("uses only .helix paths and materializes required Pi runtime assets", async () => {
    const root = await mkdtemp(join(tmpdir(), "helix-runtime-test-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "project");
    const home = join(root, ".helix");
    const paths = createHelixPaths(cwd, home);
    expect(Object.values(paths).every((path) => !path.includes("/.pi/"))).toBeTrue();
    expect(paths.projectDir).toBe(join(cwd, ".helix"));
    expect(paths.subagentSessionDir).toBe(join(home, "sessions", "subagents"));

    await preparePiRuntimeAssets(paths);
    const packageJson = JSON.parse(await readFile(join(paths.runtimeDir, "package.json"), "utf8"));
    expect(packageJson).toMatchObject({
      name: "helix",
      version: "0.2.1",
      piConfig: { name: "helix", configDir: ".helix" },
    });
    expect(JSON.parse(await readFile(join(paths.runtimeDir, "theme", "dark.json"), "utf8")).name).toBe("dark");
    expect(await readFile(join(paths.runtimeDir, "docs", "providers.md"), "utf8")).toContain("~/.helix/auth.json");
    expect(await readFile(join(paths.runtimeDir, "export-html", "template.html"), "utf8")).toContain("<!DOCTYPE html>");
    expect(await readFile(join(paths.runtimeDir, "export-html", "vendor", "marked.min.js"), "utf8")).toContain("marked");
    expect((await stat(join(paths.runtimeDir, "package.json"))).mode & 0o777).toBe(0o600);

    const previous = {
      packageDir: process.env.PI_PACKAGE_DIR,
      agentDir: process.env.HELIX_CODING_AGENT_DIR,
      skipVersion: process.env.PI_SKIP_VERSION_CHECK,
    };
    try {
      configurePiEnvironment(paths);
      expect(process.env.PI_PACKAGE_DIR).toBe(paths.runtimeDir);
      expect(process.env.HELIX_CODING_AGENT_DIR).toBe(paths.agentDir);
      expect(process.env.PI_SKIP_VERSION_CHECK).toBe("1");
    } finally {
      if (previous.packageDir === undefined) delete process.env.PI_PACKAGE_DIR;
      else process.env.PI_PACKAGE_DIR = previous.packageDir;
      if (previous.agentDir === undefined) delete process.env.HELIX_CODING_AGENT_DIR;
      else process.env.HELIX_CODING_AGENT_DIR = previous.agentDir;
      if (previous.skipVersion === undefined) delete process.env.PI_SKIP_VERSION_CHECK;
      else process.env.PI_SKIP_VERSION_CHECK = previous.skipVersion;
    }
  });
});
