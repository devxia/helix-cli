import { describe, expect, test } from "bun:test";
import { createDelegateTool } from "../src/delegate/tool.js";
import type {
  SpecialistLaunchRequest,
  SpecialistLauncher,
  SpecialistRunResult,
} from "../src/delegate/types.js";

function completed(request: SpecialistLaunchRequest, output = `result:${request.task}`): SpecialistRunResult {
  return {
    id: request.specialistRunId,
    role: request.role,
    status: "completed",
    output,
    outputTruncated: false,
    sessionFile: `/tmp/${request.specialistRunId}.jsonl`,
    durationMs: 5,
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15, cost: 0.001 },
  };
}

function context(confirm: () => Promise<boolean> = async () => true) {
  return {
    cwd: "/tmp/project",
    hasUI: true,
    model: { provider: "test-provider", id: "test-model" },
    thinkingLevel: "medium",
    ui: { confirm, setWorkingMessage: () => {} },
  } as any;
}

describe("delegate Agent Tool", () => {
  test("runs a read-only single delegation without confirmation and inherits model settings", async () => {
    const requests: SpecialistLaunchRequest[] = [];
    let confirmations = 0;
    const launch: SpecialistLauncher = async (request) => {
      requests.push(request);
      return completed(request, "scientific finding");
    };
    const tool = createDelegateTool({ launch, createId: (() => {
      let next = 0;
      return () => `id-${++next}`;
    })() });

    const result = await tool.execute(
      "call-1",
      { mode: "single", agent: "scientist", task: "Inspect FASTQ quality" },
      undefined,
      undefined,
      context(async () => {
        confirmations += 1;
        return true;
      }),
    );

    expect(confirmations).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      delegationId: "id-1",
      specialistRunId: "id-2",
      role: "scientist",
      task: "Inspect FASTQ quality",
      cwd: "/tmp/project",
      model: { provider: "test-provider", id: "test-model", thinkingLevel: "medium" },
    });
    expect(result.details).toMatchObject({ status: "completed", mode: "single" });
    expect((result.content[0] as { text: string }).text).toContain("scientific finding");
  });

  test("confirms all chain workers once before launching anything and fails closed", async () => {
    let launches = 0;
    const launch: SpecialistLauncher = async (request) => {
      launches += 1;
      return completed(request);
    };
    const tool = createDelegateTool({ launch });
    const params = {
      mode: "chain" as const,
      chain: [
        { agent: "planner" as const, task: "Plan the change" },
        { agent: "worker" as const, task: "Implement it\u001b[2J" },
        { agent: "reviewer" as const, task: "Review it" },
      ],
    };
    const prompts: string[] = [];

    await expect(tool.execute(
      "denied",
      params,
      undefined,
      undefined,
      context(async (_title?: string, message?: string) => {
        prompts.push(message ?? "");
        return false;
      }) as any,
    )).rejects.toThrow("Writer Authorization was declined");
    expect(launches).toBe(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("current user permissions");
    expect(prompts[0]).toContain("/tmp/project");
    expect(prompts[0]).not.toContain("\u001b");

    await expect(tool.execute(
      "headless",
      params,
      undefined,
      undefined,
      { ...context(), hasUI: false } as any,
    )).rejects.toThrow("requires an interactive Writer Authorization");
    expect(launches).toBe(0);
  });

  test("limits parallel concurrency to four, preserves input order, and reports partial failure", async () => {
    let active = 0;
    let peak = 0;
    const launch: SpecialistLauncher = async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(15);
      active -= 1;
      if (request.task === "fail") {
        return { ...completed(request), status: "failed", output: "", error: "provider failed" };
      }
      return completed(request, request.task);
    };
    const tool = createDelegateTool({ launch });
    const tasks = ["a", "b", "fail", "d", "e", "f"].map((task) => ({
      agent: "reviewer" as const,
      task,
    }));

    const result = await tool.execute(
      "parallel",
      { mode: "parallel", tasks },
      undefined,
      undefined,
      context(),
    );
    const details = result.details as any;

    expect(peak).toBe(4);
    expect(details.status).toBe("partial_failure");
    expect(details.runs.map((run: SpecialistRunResult) => run.output || run.error)).toEqual([
      "a", "b", "provider failed", "d", "e", "f",
    ]);
    expect((result.content[0] as { text: string }).text).toContain("PARTIAL FAILURE");
  });

  test("bounds both model-facing content and structured result previews", async () => {
    const launch: SpecialistLauncher = async (request) => completed(request, "x".repeat(20_000));
    const tool = createDelegateTool({ launch });
    const result = await tool.execute(
      "bounded",
      {
        mode: "parallel",
        tasks: Array.from({ length: 8 }, (_, index) => ({
          agent: "reviewer" as const,
          task: `review-${index}`,
        })),
      },
      undefined,
      undefined,
      context(),
    );
    const content = (result.content[0] as { text: string }).text;
    const details = result.details as any;

    expect(content.length).toBeLessThanOrEqual(65_536);
    expect(details.runs.every((run: SpecialistRunResult) => run.output.length <= 4_096)).toBeTrue();
    expect(details.runs.every((run: SpecialistRunResult) => run.outputTruncated)).toBeTrue();
  });

  test("cancels active Specialist Runs and reports cancelled progress", async () => {
    const launch: SpecialistLauncher = async (request, options) => new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error(`aborted:${request.specialistRunId}`)), { once: true });
    });
    const tool = createDelegateTool({ launch });
    const controller = new AbortController();
    const updates: any[] = [];
    const running = tool.execute(
      "cancel",
      { mode: "single", agent: "reviewer", task: "wait" },
      controller.signal,
      (update) => updates.push(update),
      context(),
    );
    setTimeout(() => controller.abort(), 10);

    await expect(running).rejects.toThrow("Delegation was cancelled");
    expect(updates.at(-1)?.details.status).toBe("cancelled");
  });

  test("passes prior chain output as untrusted evidence and stops at the first failure", async () => {
    const requests: SpecialistLaunchRequest[] = [];
    const launch: SpecialistLauncher = async (request) => {
      requests.push(request);
      if (request.task === "implement") {
        return { ...completed(request), status: "failed", output: "", error: "compile failed" };
      }
      return completed(request, request.task === "plan" ? "the plan" : "unexpected");
    };
    const tool = createDelegateTool({ launch });

    const result = await tool.execute(
      "chain",
      {
        mode: "chain",
        chain: [
          { agent: "planner", task: "plan" },
          { agent: "worker", task: "implement" },
          { agent: "reviewer", task: "review" },
        ],
      },
      undefined,
      undefined,
      context(),
    );
    const details = result.details as any;

    expect(requests).toHaveLength(2);
    expect(requests[0].previousResult).toBeUndefined();
    expect(requests[1].previousResult).toBe("the plan");
    expect(details.status).toBe("failed");
    expect(details.runs).toHaveLength(2);
  });
});
