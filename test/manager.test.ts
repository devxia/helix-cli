import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessResult } from "../src/executor/subprocess.js";
import { SeqkitManager, isSupportedSeqkitVersion, parseSeqkitVersion } from "../src/seqkit/manager.js";
import type { SeqkitAsset } from "../src/seqkit/manifest.js";
import { createExecutable, makeTarGz } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "helix-manager-test-"));
  temporaryDirectories.push(path);
  return path;
}

function result(command: readonly string[], stdout: string, exitCode = 0): ProcessResult {
  return {
    command,
    exitCode,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
  };
}

describe("SeqKit manager", () => {
  test("parses and bounds the supported PATH version", () => {
    expect(parseSeqkitVersion("seqkit v2.13.0\n")).toBe("2.13.0");
    expect(isSupportedSeqkitVersion("2.13.9")).toBeTrue();
    expect(isSupportedSeqkitVersion("2.12.9")).toBeFalse();
    expect(() => parseSeqkitVersion("v2.13.0\nextra\n")).toThrow("Unexpected SeqKit version output");
  });

  test("prefers a compatible PATH executable without confirmation", async () => {
    const root = await temporaryDirectory();
    const bin = join(root, "bin");
    const executable = await createExecutable(bin);
    const manager = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: bin,
      platform: "darwin",
      arch: "x64",
      run: async (command) => result(command, "seqkit v2.13.7\n"),
    });

    const resolved = await manager.resolve(async () => {
      throw new Error("confirmation should not be requested");
    });
    expect(resolved).toMatchObject({ path: await realpath(executable), version: "2.13.7", source: "path" });
    expect(resolved.resolutionProbes).toEqual([
      expect.objectContaining({ argv: ["version"], reportedVersion: "2.13.7", outcome: "completed" }),
    ]);
  });

  test("keeps concurrent caller cancellation independent", async () => {
    const root = await temporaryDirectory();
    const bin = join(root, "bin");
    await createExecutable(bin);
    const run = (command: readonly string[], options?: { signal?: AbortSignal }) => new Promise<ProcessResult>((resolveRun, rejectRun) => {
      if (options?.signal?.aborted) {
        rejectRun(new Error("caller aborted"));
        return;
      }
      const timer = setTimeout(() => resolveRun(result(command, "seqkit v2.13.0\n")), 80);
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        rejectRun(new Error("caller aborted"));
      }, { once: true });
    });
    const manager = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: bin,
      platform: "darwin",
      arch: "x64",
      run,
    });
    const controller = new AbortController();
    const first = manager.resolve(async () => false);
    const second = manager.resolve(async () => false, controller.signal);
    controller.abort();
    const cancellation = await second.catch((error: unknown) => error);
    expect(cancellation).toBeInstanceOf(Error);
    expect((cancellation as Error).message).toContain("caller aborted");
    expect((cancellation as Error).message).toContain('"outcome":"cancelled"');
    expect((await first).source).toBe("path");
  });

  test("remembers managed fallback until an incompatible PATH fingerprint changes", async () => {
    const root = await temporaryDirectory();
    const bin = join(root, "bin");
    const pathExecutable = await realpath(await createExecutable(bin));
    const managedExecutable = join(root, "tools", "seqkit", "2.13.0", "darwin-x64", "seqkit");
    await mkdir(join(managedExecutable, ".."), { recursive: true });
    await createExecutable(join(managedExecutable, ".."));

    const run = async (command: readonly string[]) => result(
      command,
      command[0] === pathExecutable ? "seqkit v2.12.0\n" : "seqkit v2.13.0\n",
    );
    let confirmations = 0;
    const first = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: bin,
      platform: "darwin",
      arch: "x64",
      run,
    });
    expect((await first.resolve(async () => {
      confirmations += 1;
      return true;
    })).source).toBe("managed");

    const second = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: bin,
      platform: "darwin",
      arch: "x64",
      run,
    });
    expect((await second.resolve(async () => {
      throw new Error("remembered choice should not prompt");
    })).source).toBe("managed");
    expect(confirmations).toBe(1);
  });

  test("downloads, verifies, extracts, and validates the managed executable", async () => {
    const root = await temporaryDirectory();
    const archive = makeTarGz("seqkit", new TextEncoder().encode("fake executable"));
    const asset: SeqkitAsset = {
      platform: "darwin",
      arch: "x64",
      assetName: "seqkit.tar.gz",
      url: "https://example.invalid/seqkit.tar.gz",
      sha256: createHash("sha256").update(archive).digest("hex"),
      size: archive.byteLength,
    };
    let fetches = 0;
    const manager = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: "",
      platform: "darwin",
      arch: "x64",
      asset,
      fetch: async () => {
        fetches += 1;
        return new Response(archive.slice().buffer, { status: 200 });
      },
      run: async (command) => result(command, "seqkit v2.13.0\n"),
    });

    const resolved = await manager.resolve(async ({ message }) => {
      expect(message).toContain("SeqKit 2.13.0");
      expect(message).toContain("example.invalid");
      return true;
    });
    expect(resolved.source).toBe("managed");
    expect(resolved.version).toBe("2.13.0");
    expect(fetches).toBe(1);
  });

  test("rejects a managed archive whose pinned checksum does not match", async () => {
    const root = await temporaryDirectory();
    const archive = makeTarGz("seqkit", new TextEncoder().encode("tampered"));
    const asset: SeqkitAsset = {
      platform: "darwin",
      arch: "x64",
      assetName: "seqkit.tar.gz",
      url: "https://example.invalid/seqkit.tar.gz",
      sha256: "0".repeat(64),
      size: archive.byteLength,
    };
    const manager = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: "",
      platform: "darwin",
      arch: "x64",
      asset,
      fetch: async () => new Response(archive.slice().buffer, { status: 200 }),
      run: async (command) => result(command, "seqkit v2.13.0\n"),
    });
    await expect(manager.resolve(async () => true)).rejects.toThrow("checksum mismatch");
  });

  test("stops reading a managed archive when it exceeds the pinned size", async () => {
    const root = await temporaryDirectory();
    const asset: SeqkitAsset = {
      platform: "darwin",
      arch: "x64",
      assetName: "seqkit.tar.gz",
      url: "https://example.invalid/seqkit.tar.gz",
      sha256: "0".repeat(64),
      size: 8,
    };
    const manager = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: "",
      platform: "darwin",
      arch: "x64",
      asset,
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(9));
          controller.close();
        },
      }), { status: 200 }),
    });
    await expect(manager.resolve(async () => true)).rejects.toThrow("archive size mismatch");
  });

  test("does not install when confirmation is declined", async () => {
    const root = await temporaryDirectory();
    const manager = new SeqkitManager({
      toolsDir: join(root, "tools"),
      path: "",
      platform: "darwin",
      arch: "x64",
    });
    await expect(manager.resolve(async () => false)).rejects.toThrow("was not installed");
  });
});
