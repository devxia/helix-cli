import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export const HELIX_VERSION = "0.2.1";
export const PI_VERSION = "0.82.1";

export interface HelixPaths {
  readonly agentDir: string;
  readonly projectDir: string;
  readonly runtimeDir: string;
  readonly sessionDir: string;
  readonly subagentSessionDir: string;
  readonly toolsDir: string;
}

export function defaultHelixHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.HELIX_HOME ?? join(homedir(), ".helix"));
}

export function createHelixPaths(cwd: string, agentDir = defaultHelixHome()): HelixPaths {
  const resolvedCwd = resolve(cwd);
  const resolvedAgentDir = resolve(agentDir);
  const cwdHash = createHash("sha256").update(resolvedCwd).digest("hex").slice(0, 16);
  const cwdLabel = basename(resolvedCwd).replace(/[^A-Za-z0-9._-]+/g, "-") || "root";

  return {
    agentDir: resolvedAgentDir,
    projectDir: join(resolvedCwd, ".helix"),
    runtimeDir: join(resolvedAgentDir, "runtime", `helix-${HELIX_VERSION}-pi-${PI_VERSION}`),
    sessionDir: join(resolvedAgentDir, "sessions", `${cwdLabel}-${cwdHash}`),
    subagentSessionDir: join(resolvedAgentDir, "sessions", "subagents"),
    toolsDir: join(resolvedAgentDir, "tools"),
  };
}
