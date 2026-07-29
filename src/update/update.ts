import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertTrustedAssetUrl,
  compareVersions,
  parseChecksums,
  releaseVersion,
  selectChecksumAsset,
  selectReleaseAsset,
  supportedPlatformTarget,
  type HelixPlatformTarget,
  type ReleaseInfo,
} from "./core.js";
import { HELIX_VERSION } from "../paths.js";
import { runProcess } from "../executor/subprocess.js";

const METADATA_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_METADATA_BYTES = 1_048_576;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const LATEST_RELEASE_URL = "https://api.github.com/repos/devxia/helix-cli/releases/latest";

export interface UpdateResult {
  readonly status: "already-current" | "current-newer" | "updated";
  readonly current: string;
  readonly latest: string;
  readonly executablePath?: string;
}

export interface UpdateOptions {
  readonly currentVersion?: string;
  readonly executablePath?: string;
  readonly platformTarget?: HelixPlatformTarget;
  readonly fetchRelease?: (url: string, timeoutMs: number) => Promise<ReleaseInfo>;
  readonly downloadAsset?: (url: string, timeoutMs: number, maximumBytes: number) => Promise<Uint8Array>;
}

async function fetchWithLimit(url: string, timeoutMs: number, maximumBytes: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/octet-stream",
        "user-agent": `helix/${HELIX_VERSION}`,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${url}`);
    if (!response.body) throw new Error(`No response body while downloading ${url}`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error(`Download exceeded ${maximumBytes} bytes: ${url}`);
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultFetchRelease(url: string, timeoutMs: number): Promise<ReleaseInfo> {
  const bytes = await fetchWithLimit(url, timeoutMs, MAX_METADATA_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error("GitHub release metadata was not valid JSON", { cause: error });
  }
  const release = parsed as ReleaseInfo;
  if (typeof release.tag_name !== "string" || !Array.isArray(release.assets)) {
    throw new Error("GitHub release metadata has an unexpected shape");
  }
  return release;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyNewBinary(path: string, expectedVersion: string): Promise<void> {
  const result = await runProcess([path, "--version"], { maxOutputBytes: 16_384 });
  if (result.exitCode !== 0) throw new Error(`Downloaded Helix failed --version with exit ${result.exitCode}`);
  const output = result.stdout.trim();
  if (output !== `helix ${expectedVersion}`) {
    throw new Error(`Downloaded Helix reported '${output}', expected 'helix ${expectedVersion}'`);
  }
}

export async function runHelixUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  const currentVersion = options.currentVersion ?? HELIX_VERSION;
  const fetchRelease = options.fetchRelease ?? defaultFetchRelease;
  const downloadAsset = options.downloadAsset ?? fetchWithLimit;
  const target = options.platformTarget ?? supportedPlatformTarget();
  const executablePath = await realpath(options.executablePath ?? process.execPath);
  const executableMetadata = await stat(executablePath);
  if (!executableMetadata.isFile()) throw new Error(`Helix executable is not a regular file: ${executablePath}`);
  if (executablePath.startsWith("/$bunfs/") || executablePath.endsWith("/bun")) {
    throw new Error("helix update requires an installed Helix binary; run the install.sh command instead");
  }

  const release = await fetchRelease(LATEST_RELEASE_URL, METADATA_TIMEOUT_MS);
  const latest = releaseVersion(release);
  const comparison = compareVersions(currentVersion, latest);
  if (comparison === 0) return { status: "already-current", current: currentVersion, latest };
  if (comparison > 0) return { status: "current-newer", current: currentVersion, latest };

  const checksumAsset = selectChecksumAsset(release);
  const binaryAsset = selectReleaseAsset(release, target);
  assertTrustedAssetUrl(checksumAsset.browser_download_url);
  assertTrustedAssetUrl(binaryAsset.browser_download_url);
  const checksumBytes = await downloadAsset(checksumAsset.browser_download_url, DOWNLOAD_TIMEOUT_MS, MAX_METADATA_BYTES);
  const checksums = parseChecksums(new TextDecoder().decode(checksumBytes));
  const expectedChecksum = checksums.get(binaryAsset.name);
  if (!expectedChecksum) throw new Error(`checksums.txt does not contain ${binaryAsset.name}`);
  const binary = await downloadAsset(binaryAsset.browser_download_url, DOWNLOAD_TIMEOUT_MS, MAX_ASSET_BYTES);
  const actualChecksum = sha256(binary);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Helix download checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`);
  }

  const targetDirectory = dirname(executablePath);
  const temporaryDirectory = await mkdtemp(join(targetDirectory, ".helix-update-"));
  const temporaryBinary = join(temporaryDirectory, binaryAsset.name);
  try {
    await writeFile(temporaryBinary, binary, { mode: 0o700 });
    await chmod(temporaryBinary, 0o700);
    await verifyNewBinary(temporaryBinary, latest);
    const oldPath = join(temporaryDirectory, "helix.previous");
    await readFile(executablePath); // Fail before unlinking if the file disappeared or became unreadable.
    await rm(oldPath, { force: true });
    await renameOrReplace(executablePath, temporaryBinary, oldPath);
    return { status: "updated", current: currentVersion, latest, executablePath };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function renameOrReplace(targetPath: string, nextPath: string, backupPath: string): Promise<void> {
  const { rename } = await import("node:fs/promises");
  try {
    await rename(nextPath, targetPath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "EPERM" || error.code === "EACCES"))) {
      throw error;
    }
    await rename(targetPath, backupPath);
    try {
      await rename(nextPath, targetPath);
    } catch (nextError) {
      await rename(backupPath, targetPath).catch(() => undefined);
      throw nextError;
    }
  }
}

export function formatUpdateResult(result: UpdateResult): string {
  if (result.status === "already-current") return `Helix is already up to date (${result.latest}).\n`;
  if (result.status === "current-newer") return `Helix ${result.current} is newer than the stable latest release (${result.latest}).\n`;
  return `Current: ${result.current}\nLatest: ${result.latest}\nInstalled: ${result.executablePath}\nHelix was updated successfully.\n`;
}
