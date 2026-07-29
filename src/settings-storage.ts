import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type HelixSettingsScope = "global" | "project";

const RESTRICTED_RESOURCE_FIELDS = ["packages", "extensions", "skills", "prompts", "themes"] as const;
const LOCK_WAIT_MS = 10_000;
const STALE_LOCK_MS = 30_000;
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));

function acquireLock(path: string): number {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      const descriptor = openSync(path, "wx", 0o600);
      writeFileSync(descriptor, `${process.pid}\n`);
      return descriptor;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) {
          rmSync(path, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for settings lock: ${path}`);
      Atomics.wait(SLEEP_BUFFER, 0, 0, 25);
    }
  }
}

function sanitizeSettings(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return content;
    const settings = parsed as Record<string, unknown>;
    for (const field of RESTRICTED_RESOURCE_FIELDS) settings[field] = [];
    settings.enableInstallTelemetry = false;
    settings.enableAnalytics = false;
    return `${JSON.stringify(settings, null, 2)}\n`;
  } catch {
    return content;
  }
}

/**
 * SettingsManager storage that preserves Pi settings behavior while ensuring
 * resource packages and telemetry cannot be enabled from persisted files.
 */
export class HelixSettingsStorage {
  readonly #globalPath: string;
  readonly #projectPath: string;

  constructor(cwd: string, agentDir: string) {
    this.#globalPath = join(agentDir, "settings.json");
    this.#projectPath = join(cwd, ".helix", "settings.json");
  }

  withLock(scope: HelixSettingsScope, update: (current: string | undefined) => string | undefined): void {
    const path = scope === "global" ? this.#globalPath : this.#projectPath;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const lockPath = `${path}.lock`;
    const lockDescriptor = acquireLock(lockPath);
    try {
      const current = existsSync(path) ? sanitizeSettings(readFileSync(path, "utf8")) : undefined;
      const next = update(current);
      if (next === undefined) return;

      const sanitized = sanitizeSettings(next)!;
      const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
      try {
        writeFileSync(temporaryPath, sanitized, { mode: 0o600 });
        renameSync(temporaryPath, path);
        chmodSync(path, 0o600);
      } finally {
        rmSync(temporaryPath, { force: true });
      }
    } finally {
      closeSync(lockDescriptor);
      rmSync(lockPath, { force: true });
    }
  }
}
