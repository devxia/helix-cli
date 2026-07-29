export interface PlatformInput {
  readonly platform: NodeJS.Platform | string;
  readonly arch: string;
}

export type HelixPlatformTarget = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64";

export interface ReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

export interface ReleaseInfo {
  readonly tag_name: string;
  readonly prerelease?: boolean;
  readonly assets: readonly ReleaseAsset[];
}

const STABLE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ASSET_NAME = /^[A-Za-z0-9._-]+$/;

export function normalizeVersion(value: string): string {
  const match = STABLE_VERSION.exec(value.trim());
  if (!match) throw new Error(`Expected a stable x.y.z version, received: ${value}`);
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function numericParts(version: string): [number, number, number] {
  const normalized = normalizeVersion(version);
  return normalized.split(".").map(Number) as [number, number, number];
}

export function compareVersions(left: string, right: string): number {
  const a = numericParts(left);
  const b = numericParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! < b[index]!) return -1;
    if (a[index]! > b[index]!) return 1;
  }
  return 0;
}

export function supportedPlatformTarget(input: PlatformInput = { platform: process.platform, arch: process.arch }): HelixPlatformTarget {
  const os = input.platform === "darwin" ? "darwin" : input.platform === "linux" ? "linux" : undefined;
  if (!os) throw new Error(`Helix update is unsupported on platform: ${input.platform}`);
  const arch = input.arch === "arm64" || input.arch === "aarch64"
    ? "arm64"
    : input.arch === "x64" || input.arch === "amd64" || input.arch === "x86_64"
      ? "x64"
      : undefined;
  if (!arch) throw new Error(`Helix update is unsupported on architecture: ${input.arch}`);
  return `${os}-${arch}` as HelixPlatformTarget;
}

export function releaseVersion(release: ReleaseInfo): string {
  if (release.prerelease) throw new Error(`Latest Helix release is a prerelease: ${release.tag_name}`);
  return normalizeVersion(release.tag_name);
}

export function assertTrustedAssetUrl(url: string): void {
  if (!/^https:\/\/github\.com\/devxia\/helix-cli\//.test(url)) {
    throw new Error(`Helix asset has an unexpected download URL: ${url}`);
  }
}

export function selectReleaseAsset(release: ReleaseInfo, target: HelixPlatformTarget): ReleaseAsset {
  const name = `helix-${target}`;
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) throw new Error(`Helix release ${release.tag_name} is missing asset: ${name}`);
  return asset;
}

export function selectChecksumAsset(release: ReleaseInfo): ReleaseAsset {
  const asset = release.assets.find((candidate) => candidate.name === "checksums.txt");
  if (!asset) throw new Error(`Helix release ${release.tag_name} is missing checksums.txt`);
  return asset;
}

export function parseChecksums(content: string): Map<string, string> {
  const checksums = new Map<string, string>();
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("checksums.txt is empty");
  for (const line of lines) {
    const match = /^([a-f0-9]{64})\s+([A-Za-z0-9._-]+)$/.exec(line);
    if (!match) throw new Error(`checksums.txt contains an invalid entry: ${line}`);
    const [, checksum, name] = match;
    if (!SHA256.test(checksum!)) throw new Error(`checksums.txt contains an invalid checksum for ${name}`);
    if (!SAFE_ASSET_NAME.test(name!) || name!.includes("..")) throw new Error(`checksums.txt contains an unsafe asset name: ${name}`);
    checksums.set(name!, checksum!);
  }
  return checksums;
}
