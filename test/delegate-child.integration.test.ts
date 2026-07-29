import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchSpecialistProcess } from "../src/delegate/process.js";
import { SPECIALIST_PROTOCOL_VERSION, type SpecialistLaunchRequest } from "../src/delegate/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Specialist self-spawn integration", () => {
  test("runs a fresh child session through the same Helix entrypoint and stays under HELIX_HOME", async () => {
    const root = await mkdtemp(join(tmpdir(), "helix-specialist-integration-"));
    temporaryDirectories.push(root);
    const home = join(root, ".helix");
    const cwd = join(root, "project");
    await mkdir(join(home), { recursive: true });
    await mkdir(cwd, { recursive: true });

    let providerPayload: any;
    const server = Bun.serve({
      port: 0,
      fetch: async (incoming) => {
        providerPayload = JSON.parse(await incoming.text());
        const chunks = [
          { id: "mock", object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta: { role: "assistant", content: "specialist ok" }, finish_reason: null }] },
          { id: "mock", object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
        ];
        const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });

    try {
      await writeFile(join(home, "models.json"), `${JSON.stringify({
        providers: {
          mock: {
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            api: "openai-completions",
            apiKey: "test-key",
            models: [{ id: "mock-model" }],
          },
        },
      })}\n`, { mode: 0o600 });

      const request: SpecialistLaunchRequest = {
        protocolVersion: SPECIALIST_PROTOCOL_VERSION,
        delegationId: "11111111-1111-4111-8111-111111111111",
        specialistRunId: "22222222-2222-4222-8222-222222222222",
        role: "reviewer",
        task: "Return the review result",
        cwd,
        model: { provider: "mock", id: "mock-model", thinkingLevel: "off" },
      };
      const result = await launchSpecialistProcess(request, {}, {
        command: [process.execPath, resolve("src/main.ts")],
        timeoutMs: 10_000,
        env: { ...process.env, HELIX_HOME: home },
      });

      expect(result).toMatchObject({
        status: "completed",
        output: "specialist ok",
        role: "reviewer",
        usage: { input: 10, output: 2, total: 12 },
      });
      expect(result.sessionFile?.startsWith(join(home, "sessions", "subagents"))).toBeTrue();
      expect(await Bun.file(result.sessionFile!).exists()).toBeTrue();
      const toolNames = providerPayload.tools.map((tool: any) => tool.function.name);
      expect(toolNames).toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "inspect_fastx", "inspect_bam"]));
      expect(toolNames).not.toEqual(expect.arrayContaining(["delegate", "bash", "edit", "write"]));
      expect(providerPayload.messages[0].content).toContain("Helix Reviewer");
      expect(await Bun.file(join(root, ".pi")).exists()).toBeFalse();
      expect(await Bun.file(join(cwd, ".pi")).exists()).toBeFalse();
    } finally {
      server.stop(true);
    }
  }, 20_000);
});
