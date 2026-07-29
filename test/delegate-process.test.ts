import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSelfSpawnCommand,
  launchSpecialistProcess,
  SpecialistProcessCancelledError,
} from "../src/delegate/process.js";
import { parseSpecialistLaunchRequest } from "../src/delegate/protocol.js";
import { SPECIALIST_PROTOCOL_VERSION, type SpecialistLaunchRequest } from "../src/delegate/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function request(): SpecialistLaunchRequest {
  return {
    protocolVersion: SPECIALIST_PROTOCOL_VERSION,
    delegationId: "11111111-1111-4111-8111-111111111111",
    specialistRunId: "22222222-2222-4222-8222-222222222222",
    role: "reviewer",
    task: "Review the result",
    cwd: process.cwd(),
    model: { provider: "test", id: "model", thinkingLevel: "high" },
  };
}

async function script(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "helix-delegate-process-"));
  temporaryDirectories.push(root);
  const path = join(root, "child.ts");
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

describe("Specialist child process protocol", () => {
  test("validates private requests and rejects path or field injection", () => {
    expect(parseSpecialistLaunchRequest(request())).toEqual(request());
    expect(() => parseSpecialistLaunchRequest({ ...request(), delegationId: "../escape" })).toThrow("delegationId");
    expect(() => parseSpecialistLaunchRequest({ ...request(), cwd: "relative" })).toThrow("absolute");
    expect(() => parseSpecialistLaunchRequest({ ...request(), extra: true })).toThrow("unexpected field");
  });

  test("builds source and compiled self-spawn commands without external runtimes", () => {
    expect(buildSelfSpawnCommand({ execPath: "/opt/bun", bunMain: "/repo/src/main.ts" })).toEqual([
      "/opt/bun",
      "/repo/src/main.ts",
    ]);
    expect(buildSelfSpawnCommand({ execPath: "/opt/helix", bunMain: "/$bunfs/root/helix" })).toEqual([
      "/opt/helix",
    ]);
  });

  test("sends a bounded JSON request over stdin and parses the child result", async () => {
    const child = await script(`
const input = await Bun.stdin.text();
const request = JSON.parse(input);
console.log(JSON.stringify({
  id: request.specialistRunId,
  role: request.role,
  status: "completed",
  output: "reviewed",
  outputTruncated: false,
  sessionFile: "/tmp/session.jsonl",
  durationMs: 12,
  usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, total: 5, cost: 0.01 }
}));
`);
    const result = await launchSpecialistProcess(request(), {}, {
      command: [process.execPath, child],
      timeoutMs: 1_000,
    });
    expect(result).toMatchObject({ status: "completed", output: "reviewed", role: "reviewer" });
  });

  test("rejects malformed output and nonzero children", async () => {
    const malformed = await script(`await Bun.stdin.text(); console.log("not-json");`);
    await expect(launchSpecialistProcess(request(), {}, {
      command: [process.execPath, malformed],
      timeoutMs: 1_000,
    })).rejects.toThrow("invalid JSON");

    const failed = await script(`await Bun.stdin.text(); console.error("child exploded"); process.exit(7);`);
    await expect(launchSpecialistProcess(request(), {}, {
      command: [process.execPath, failed],
      timeoutMs: 1_000,
    })).rejects.toThrow("child exploded");
  });

  test("distinguishes timeout from parent cancellation", async () => {
    const slow = await script(`await Bun.stdin.text(); await Bun.sleep(10_000);`);
    const timedOut = await launchSpecialistProcess(request(), {}, {
      command: [process.execPath, slow],
      timeoutMs: 20,
    });
    expect(timedOut).toMatchObject({ status: "timed_out", error: "Specialist Run timed out after 20ms" });

    const controller = new AbortController();
    const running = launchSpecialistProcess(request(), { signal: controller.signal }, {
      command: [process.execPath, slow],
      timeoutMs: 1_000,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toBeInstanceOf(SpecialistProcessCancelledError);
  });
});
