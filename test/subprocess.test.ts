import { describe, expect, test } from "bun:test";
import { ProcessCancelledError, runProcess } from "../src/executor/subprocess.js";

describe("subprocess execution", () => {
  test("captures stdout and stderr without a shell", async () => {
    const result = await runProcess([process.execPath, "-e", "console.log('out'); console.error('err')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(result.command[0]).toBe(process.execPath);
  });

  test("bounds captured output without flagging an exact-size result", async () => {
    const result = await runProcess([process.execPath, "-e", "process.stdout.write('x'.repeat(10000))"], {
      maxOutputBytes: 100,
    });
    expect(result.stdout).toHaveLength(100);
    expect(result.stdoutTruncated).toBeTrue();

    const exact = await runProcess([process.execPath, "-e", "process.stdout.write('x'.repeat(100))"], {
      maxOutputBytes: 100,
    });
    expect(exact.stdoutTruncated).toBeFalse();
  });

  test("terminates an aborted process and rejects partial output", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await expect(runProcess([
      process.execPath,
      "-e",
      "process.stdout.write('partial'); await new Promise(resolve => setTimeout(resolve, 10000))",
    ], { signal: controller.signal })).rejects.toBeInstanceOf(ProcessCancelledError);
  });
});
