import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { runProcess, type ProcessResult } from "../executor/subprocess.js";
import { extractSeqkitFromTarGz } from "./archive.js";
import { getSeqkitAsset, SEQKIT_SUPPORTED_RANGE, SEQKIT_VERSION, type SeqkitAsset } from "./manifest.js";

export type SeqkitSource = "path" | "managed";

export interface SeqkitResolutionProbe {
  readonly executable: string;
  readonly argv: readonly ["version"];
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly reportedVersion: string | null;
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly diagnostics?: string;
}

export interface ResolvedSeqkit {
  readonly path: string;
  readonly version: string;
  readonly source: SeqkitSource;
  readonly resolutionProbes: readonly SeqkitResolutionProbe[];
}

export interface SeqkitConfirmation {
  readonly title: string;
  readonly message: string;
}

export type ConfirmSeqkit = (confirmation: SeqkitConfirmation) => Promise<boolean>;

type ProcessRunner = (command: readonly string[], options?: { signal?: AbortSignal; maxOutputBytes?: number }) => Promise<ProcessResult>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface SeqkitManagerOptions {
  readonly toolsDir: string;
  readonly path?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly fetch?: Fetcher;
  readonly run?: ProcessRunner;
  readonly asset?: SeqkitAsset;
}

interface ToolState {
  readonly version: 1;
  readonly managedForPath?: {
    readonly path: string;
    readonly version: string;
  };
}

interface DetectedPath {
  readonly path: string;
  readonly version: string;
  readonly compatible: boolean;
  readonly probe: SeqkitResolutionProbe;
}

interface ManagedLookup {
  readonly tool?: ResolvedSeqkit;
  readonly probes: readonly SeqkitResolutionProbe[];
}

const VERSION_PATTERN = /^seqkit v(\d+)\.(\d+)\.(\d+)\r?\n?$/;

async function readResponseExactly(response: Response, expectedBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== expectedBytes) {
    throw new Error(`SeqKit archive size mismatch: expected ${expectedBytes}, received ${declaredLength}`);
  }
  if (!response.body) throw new Error("SeqKit download returned an empty response body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > expectedBytes) {
        await reader.cancel();
        throw new Error(`SeqKit archive size mismatch: expected ${expectedBytes}, received more data`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes !== expectedBytes) {
    throw new Error(`SeqKit archive size mismatch: expected ${expectedBytes}, received ${totalBytes}`);
  }

  const archive = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return archive;
}

export function parseSeqkitVersion(output: string): string {
  const match = VERSION_PATTERN.exec(output);
  if (!match) throw new Error(`Unexpected SeqKit version output: ${JSON.stringify(output)}`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function isSupportedSeqkitVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match !== null && Number(match[1]) === 2 && Number(match[2]) === 13;
}

function appendResolutionProvenance(error: unknown, probes: readonly SeqkitResolutionProbe[]): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (probes.length === 0 || message.includes("SeqKit resolution provenance:")) {
    return error instanceof Error ? error : new Error(message);
  }
  return new Error(`${message}\nSeqKit resolution provenance: ${JSON.stringify(probes)}`, { cause: error });
}

async function atomicPrivateWrite(path: string, content: string | Uint8Array, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await writeFile(temporaryPath, content, { mode });
    await rename(temporaryPath, path);
    await chmod(path, mode);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export class SeqkitManager {
  readonly #toolsDir: string;
  readonly #path: string;
  readonly #platform: NodeJS.Platform;
  readonly #arch: NodeJS.Architecture;
  readonly #fetch: Fetcher;
  readonly #run: ProcessRunner;
  readonly #asset?: SeqkitAsset;

  constructor(options: SeqkitManagerOptions) {
    this.#toolsDir = options.toolsDir;
    this.#path = options.path ?? process.env.PATH ?? "";
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
    this.#fetch = options.fetch ?? fetch;
    this.#run = options.run ?? runProcess;
    this.#asset = options.asset;
  }

  resolve(confirm: ConfirmSeqkit, signal?: AbortSignal): Promise<ResolvedSeqkit> {
    return this.#resolve(confirm, signal);
  }

  async #resolve(confirm: ConfirmSeqkit, signal?: AbortSignal): Promise<ResolvedSeqkit> {
    const detected = await this.#detectPathSeqkit(signal);
    const probes: SeqkitResolutionProbe[] = detected ? [detected.probe] : [];
    if (detected?.compatible) {
      return { path: detected.path, version: detected.version, source: "path", resolutionProbes: probes };
    }

    const managedLookup = await this.#findManaged(signal);
    probes.push(...managedLookup.probes);
    const managed = managedLookup.tool;
    if (detected) {
      const state = await this.#readState();
      if (state.managedForPath?.path === detected.path && state.managedForPath.version === detected.version) {
        if (managed) return { ...managed, resolutionProbes: probes };
        try {
          const installed = await this.#installManaged(signal);
          return { ...installed, resolutionProbes: [...probes, ...installed.resolutionProbes] };
        } catch (error) {
          throw appendResolutionProvenance(error, probes);
        }
      }

      const asset = this.#asset ?? getSeqkitAsset(this.#platform, this.#arch);
      const fallback = managed
        ? `Use the installed Helix-managed copy at ${managed.path}?`
        : `Download SeqKit ${SEQKIT_VERSION} (${formatBytes(asset.size)}) from ${asset.url} and install it under ${this.#managedRoot()}?`;
      const accepted = await confirm({
        title: "Use managed SeqKit?",
        message: `PATH contains SeqKit ${detected.version} at ${detected.path}, but Helix supports ${SEQKIT_SUPPORTED_RANGE}. ${fallback}`,
      });
      if (!accepted) {
        throw appendResolutionProvenance(
          new Error(`SeqKit ${detected.version} is unsupported; Helix requires ${SEQKIT_SUPPORTED_RANGE}.`),
          probes,
        );
      }

      let resolved: ResolvedSeqkit;
      let resolutionProbes = probes;
      try {
        if (managed) {
          resolved = managed;
        } else {
          resolved = await this.#installManaged(signal);
          resolutionProbes = [...probes, ...resolved.resolutionProbes];
        }
      } catch (error) {
        throw appendResolutionProvenance(error, probes);
      }
      await this.#writeState({
        version: 1,
        managedForPath: { path: detected.path, version: detected.version },
      });
      return { ...resolved, resolutionProbes };
    }

    if (managed) return managed;

    const asset = this.#asset ?? getSeqkitAsset(this.#platform, this.#arch);
    const accepted = await confirm({
      title: "Install SeqKit?",
      message: `Download SeqKit ${SEQKIT_VERSION} (${formatBytes(asset.size)}) from ${asset.url} and install it under ${this.#managedRoot()}?`,
    });
    if (!accepted) {
      throw appendResolutionProvenance(
        new Error("SeqKit is required for this inspection and was not installed."),
        probes,
      );
    }
    try {
      const installed = await this.#installManaged(signal, asset);
      return { ...installed, resolutionProbes: [...probes, ...installed.resolutionProbes] };
    } catch (error) {
      throw appendResolutionProvenance(error, probes);
    }
  }

  async #probeVersion(path: string, signal?: AbortSignal): Promise<{ version: string; probe: SeqkitResolutionProbe }> {
    const startedAt = performance.now();
    let result: ProcessResult;
    try {
      result = await this.#run([path, "version"], { signal, maxOutputBytes: 4_096 });
    } catch (error) {
      const outcome = signal?.aborted ? "cancelled" : "failed";
      const probe: SeqkitResolutionProbe = {
        executable: path,
        argv: ["version"],
        durationMs: Math.round(performance.now() - startedAt),
        exitCode: null,
        reportedVersion: null,
        outcome,
        diagnostics: error instanceof Error ? error.message : String(error),
      };
      throw appendResolutionProvenance(error, [probe]);
    }

    let version = "unknown";
    if (result.exitCode === 0 && !result.stdoutTruncated) {
      try {
        version = parseSeqkitVersion(result.stdout);
      } catch {
        // An executable named seqkit with an unknown contract is unsupported.
      }
    }
    const diagnostics = result.stderr.trim() || (version === "unknown" ? result.stdout.trim() : "");
    const probe: SeqkitResolutionProbe = {
      executable: path,
      argv: ["version"],
      durationMs: Math.round(result.durationMs),
      exitCode: result.exitCode,
      reportedVersion: version === "unknown" ? null : version,
      outcome: result.exitCode === 0 && !result.stdoutTruncated && version !== "unknown" ? "completed" : "failed",
      ...(diagnostics ? { diagnostics: diagnostics.slice(0, 4_096) } : {}),
    };
    return { version, probe };
  }

  async #detectPathSeqkit(signal?: AbortSignal): Promise<DetectedPath | undefined> {
    for (const directory of this.#path.split(delimiter)) {
      if (!directory) continue;
      const candidate = join(directory, "seqkit");
      try {
        await access(candidate, fsConstants.X_OK);
      } catch (error) {
        if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) {
          continue;
        }
        throw error;
      }
      const resolvedPath = await realpath(candidate);
      const { version, probe } = await this.#probeVersion(resolvedPath, signal);
      return { path: resolvedPath, version, compatible: isSupportedSeqkitVersion(version), probe };
    }
    return undefined;
  }

  async #findManaged(signal?: AbortSignal): Promise<ManagedLookup> {
    const path = this.#managedExecutable();
    try {
      await access(path, fsConstants.X_OK);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) {
        return { probes: [] };
      }
      throw error;
    }

    const { version, probe } = await this.#probeVersion(path, signal);
    const tool = version === SEQKIT_VERSION && probe.outcome === "completed"
      ? { path, version, source: "managed" as const, resolutionProbes: [probe] }
      : undefined;
    return { tool, probes: [probe] };
  }

  async #installManaged(signal?: AbortSignal, selectedAsset?: SeqkitAsset): Promise<ResolvedSeqkit> {
    const asset = selectedAsset ?? this.#asset ?? getSeqkitAsset(this.#platform, this.#arch);
    const response = await this.#fetch(asset.url, {
      headers: { "User-Agent": `helix/${SEQKIT_VERSION}` },
      redirect: "follow",
      signal,
    });
    if (!response.ok) throw new Error(`Failed to download SeqKit: HTTP ${response.status}`);

    const archive = await readResponseExactly(response, asset.size);
    const digest = createHash("sha256").update(archive).digest("hex");
    if (digest !== asset.sha256) {
      throw new Error(`SeqKit archive checksum mismatch: expected ${asset.sha256}, received ${digest}`);
    }

    const executable = extractSeqkitFromTarGz(archive);
    const target = this.#managedExecutable();
    const temporary = `${target}.install-${process.pid}-${crypto.randomUUID()}`;
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, executable, { mode: 0o700 });
      await chmod(temporary, 0o700);
      const { version, probe } = await this.#probeVersion(temporary, signal);
      if (version !== SEQKIT_VERSION || probe.outcome !== "completed") {
        throw appendResolutionProvenance(
          new Error(`Downloaded SeqKit did not report version ${SEQKIT_VERSION}`),
          [probe],
        );
      }
      await rename(temporary, target);
      await chmod(target, 0o700);
      return { path: target, version: SEQKIT_VERSION, source: "managed", resolutionProbes: [probe] };
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async #readState(): Promise<ToolState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#statePath(), "utf8"));
      if (typeof parsed !== "object" || parsed === null || (parsed as { version?: unknown }).version !== 1) {
        return { version: 1 };
      }
      const candidate = parsed as ToolState;
      if (candidate.managedForPath && (
        typeof candidate.managedForPath.path !== "string" || typeof candidate.managedForPath.version !== "string"
      )) {
        return { version: 1 };
      }
      return candidate;
    } catch {
      return { version: 1 };
    }
  }

  async #writeState(state: ToolState): Promise<void> {
    await atomicPrivateWrite(this.#statePath(), `${JSON.stringify(state, null, 2)}\n`, 0o600);
  }

  #managedRoot(): string {
    return join(this.#toolsDir, "seqkit", SEQKIT_VERSION, `${this.#platform}-${this.#arch}`);
  }

  #managedExecutable(): string {
    return join(this.#managedRoot(), "seqkit");
  }

  #statePath(): string {
    return join(this.#toolsDir, "seqkit", "state.json");
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
