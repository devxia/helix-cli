import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHelixUpdate } from "../src/update/update.js";
import { HELIX_VERSION } from "../src/paths.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function executable(version: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "helix-update-test-"));
  temporaryDirectories.push(root);
  const path = join(root, "helix");
  await writeFile(path, `#!/bin/sh\nprintf 'helix ${version}\\n'\n`, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

describe("helix update", () => {
  test("reports already up to date without downloading assets", async () => {
    const current = await executable(HELIX_VERSION);
    let downloads = 0;
    const result = await runHelixUpdate({
      currentVersion: HELIX_VERSION,
      executablePath: current,
      fetchRelease: async () => ({
        tag_name: `v${HELIX_VERSION}`,
        prerelease: false,
        assets: [],
      }),
      downloadAsset: async () => {
        downloads += 1;
        throw new Error("should not download");
      },
    });

    expect(result).toMatchObject({ status: "already-current", latest: HELIX_VERSION });
    expect(downloads).toBe(0);
  });

  test("downloads checksum and asset, verifies the new binary, and atomically replaces execPath", async () => {
    const current = await executable(HELIX_VERSION);
    const nextVersion = "0.99.0";
    const nextBinary = `#!/bin/sh\nprintf 'helix ${nextVersion}\\n'\n`;
    const checksum = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nextBinary));
    const hex = [...new Uint8Array(checksum)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const downloads: string[] = [];

    const result = await runHelixUpdate({
      currentVersion: HELIX_VERSION,
      executablePath: current,
      fetchRelease: async () => ({
        tag_name: `v${nextVersion}`,
        prerelease: false,
        assets: [
          { name: "helix-darwin-arm64", browser_download_url: "https://github.com/devxia/helix-cli/releases/download/v0.99.0/helix-darwin-arm64" },
          { name: "checksums.txt", browser_download_url: "https://github.com/devxia/helix-cli/releases/download/v0.99.0/checksums.txt" },
        ],
      }),
      downloadAsset: async (url) => {
        downloads.push(url);
        return url.endsWith("checksums.txt")
          ? new TextEncoder().encode(`${hex}  helix-darwin-arm64\n`)
          : new TextEncoder().encode(nextBinary);
      },
      platformTarget: "darwin-arm64",
    });

    expect(result).toMatchObject({ status: "updated", current: HELIX_VERSION, latest: nextVersion });
    expect(downloads).toEqual([
      "https://github.com/devxia/helix-cli/releases/download/v0.99.0/checksums.txt",
      "https://github.com/devxia/helix-cli/releases/download/v0.99.0/helix-darwin-arm64",
    ]);
    const verify = Bun.spawn([current, "--version"]);
    expect(await new Response(verify.stdout).text()).toBe(`helix ${nextVersion}\n`);
    expect(await verify.exited).toBe(0);
  });

  test("reports current newer than stable latest without downloading", async () => {
    const current = await executable("0.99.0");
    let downloads = 0;
    const result = await runHelixUpdate({
      currentVersion: "0.99.0",
      executablePath: current,
      fetchRelease: async () => ({
        tag_name: "v0.2.1",
        prerelease: false,
        assets: [],
      }),
      downloadAsset: async () => {
        downloads += 1;
        throw new Error("should not download");
      },
    });
    expect(result).toMatchObject({ status: "current-newer", current: "0.99.0", latest: "0.2.1" });
    expect(downloads).toBe(0);
  });

  test("rejects prerelease releases and the bun/dev executable path", async () => {
    await expect(runHelixUpdate({
      currentVersion: HELIX_VERSION,
      executablePath: await executable(HELIX_VERSION),
      fetchRelease: async () => ({ tag_name: "v0.99.0-beta.1", prerelease: true, assets: [] }),
      downloadAsset: async () => { throw new Error("should not download"); },
    })).rejects.toThrow("prerelease");

    const bunPath = join(await mkdtemp(join(tmpdir(), "helix-bun-guard-")), "bun");
    await writeFile(bunPath, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(bunPath, 0o700);
    await expect(runHelixUpdate({
      currentVersion: HELIX_VERSION,
      executablePath: bunPath,
      fetchRelease: async () => ({ tag_name: "v0.99.0", prerelease: false, assets: [] }),
      downloadAsset: async () => { throw new Error("should not download"); },
    })).rejects.toThrow("installed Helix binary");
  });

  test("leaves the old executable untouched when checksum verification fails", async () => {
    const current = await executable(HELIX_VERSION);
    const before = await Bun.file(current).bytes();
    await expect(runHelixUpdate({
      currentVersion: HELIX_VERSION,
      executablePath: current,
      fetchRelease: async () => ({
        tag_name: "v0.99.0",
        prerelease: false,
        assets: [
          { name: "helix-darwin-arm64", browser_download_url: "https://github.com/devxia/helix-cli/releases/download/v0.99.0/helix-darwin-arm64" },
          { name: "checksums.txt", browser_download_url: "https://github.com/devxia/helix-cli/releases/download/v0.99.0/checksums.txt" },
        ],
      }),
      downloadAsset: async (url) => new TextEncoder().encode(url.endsWith("checksums.txt") ? `${"0".repeat(64)}  helix-darwin-arm64\n` : "bad"),
      platformTarget: "darwin-arm64",
    })).rejects.toThrow("checksum mismatch");

    expect(await Bun.file(current).bytes()).toEqual(before);
  });
});
