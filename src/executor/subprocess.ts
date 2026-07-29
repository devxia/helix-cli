export interface ProcessResult {
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
}

export interface RunProcessOptions {
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly maxOutputBytes?: number;
}

export class ProcessCancelledError extends Error {
  constructor() {
    super("Process execution was cancelled");
    this.name = "ProcessCancelledError";
  }
}

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (retainedBytes < maximumBytes) {
        const remaining = maximumBytes - retainedBytes;
        const retained = value.byteLength <= remaining ? value : value.subarray(0, remaining);
        chunks.push(retained);
        retainedBytes += retained.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(retainedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(output), truncated: totalBytes > maximumBytes };
}

export async function runProcess(command: readonly string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
  if (command.length === 0) throw new Error("Process command cannot be empty");
  if (options.signal?.aborted) throw new ProcessCancelledError();

  const startedAt = performance.now();
  const maximumBytes = options.maxOutputBytes ?? 1_048_576;
  const subprocess = Bun.spawn([...command], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let cancelled = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    cancelled = true;
    subprocess.kill();
    forceKillTimer = setTimeout(() => subprocess.kill(9), 2_000);
    forceKillTimer.unref?.();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      readLimited(subprocess.stdout, maximumBytes),
      readLimited(subprocess.stderr, maximumBytes),
    ]);

    if (cancelled || options.signal?.aborted) throw new ProcessCancelledError();

    return {
      command,
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      durationMs: performance.now() - startedAt,
    };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  }
}
