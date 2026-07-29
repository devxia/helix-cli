import { SPECIALIST_TIMEOUT_MS } from "./contract.js";
import { parseSpecialistRunResult } from "./protocol.js";
import type { SpecialistLaunchOptions, SpecialistLaunchRequest, SpecialistRunResult } from "./types.js";

const MAX_PROTOCOL_STDOUT_BYTES = 1_048_576;
const MAX_PROTOCOL_STDERR_BYTES = 65_536;
const FORCE_KILL_AFTER_MS = 2_000;
export const SPECIALIST_CHILD_ENV = "HELIX_INTERNAL_SPECIALIST";

export class SpecialistProcessCancelledError extends Error {
  constructor() {
    super("Specialist Run was cancelled");
    this.name = "SpecialistProcessCancelledError";
  }
}

export interface SelfSpawnEnvironment {
  readonly execPath: string;
  readonly bunMain: string;
}

export interface SpecialistProcessRuntimeOptions {
  readonly command?: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export function buildSelfSpawnCommand(environment: SelfSpawnEnvironment = {
  execPath: process.execPath,
  bunMain: Bun.main,
}): string[] {
  if (environment.bunMain.startsWith("/$bunfs/")) return [environment.execPath];
  return [environment.execPath, environment.bunMain];
}

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (retained < maximumBytes) {
        const chunk = value.subarray(0, maximumBytes - retained);
        chunks.push(chunk);
        retained += chunk.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(retained);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated: total > maximumBytes };
}

function diagnostic(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length > 0 ? trimmed : "No child diagnostic output";
}

export async function launchSpecialistProcess(
  request: SpecialistLaunchRequest,
  options: SpecialistLaunchOptions,
  runtime: SpecialistProcessRuntimeOptions = {},
): Promise<SpecialistRunResult> {
  if (options.signal?.aborted) throw new SpecialistProcessCancelledError();
  const command = runtime.command ?? buildSelfSpawnCommand();
  if (command.length === 0) throw new Error("Specialist child command cannot be empty");
  const timeoutMs = runtime.timeoutMs ?? SPECIALIST_TIMEOUT_MS;
  const startedAt = performance.now();
  const subprocess = Bun.spawn([...command], {
    cwd: request.cwd,
    env: {
      ...(runtime.env ?? process.env),
      [SPECIALIST_CHILD_ENV]: "1",
    },
    stdin: new Blob([JSON.stringify(request)]),
    stdout: "pipe",
    stderr: "pipe",
  });

  let terminalReason: "cancelled" | "timed_out" | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = (reason: "cancelled" | "timed_out") => {
    if (terminalReason) return;
    terminalReason = reason;
    subprocess.kill();
    forceKillTimer = setTimeout(() => subprocess.kill(9), FORCE_KILL_AFTER_MS);
    forceKillTimer.unref?.();
  };
  const onAbort = () => terminate("cancelled");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => terminate("timed_out"), timeoutMs);
  timeout.unref?.();

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      readLimited(subprocess.stdout, MAX_PROTOCOL_STDOUT_BYTES),
      readLimited(subprocess.stderr, MAX_PROTOCOL_STDERR_BYTES),
    ]);
    const durationMs = Math.round(performance.now() - startedAt);
    if (terminalReason === "cancelled" || options.signal?.aborted) throw new SpecialistProcessCancelledError();
    if (terminalReason === "timed_out") {
      return {
        id: request.specialistRunId,
        role: request.role,
        status: "timed_out",
        output: "",
        outputTruncated: false,
        durationMs,
        error: `Specialist Run timed out after ${timeoutMs}ms`,
      };
    }
    if (stderr.truncated) throw new Error("Specialist child stderr exceeded the protocol capture limit");
    if (exitCode !== 0) throw new Error(`Specialist child exited with status ${exitCode}: ${diagnostic(stderr.text)}`);
    if (stdout.truncated) throw new Error("Specialist child stdout exceeded the protocol capture limit");

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.text);
    } catch (error) {
      throw new Error("Specialist child returned invalid JSON", { cause: error });
    }
    return parseSpecialistRunResult(parsed, request);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
}
