import { describe, expect, test } from "bun:test";
import {
  assertTrustedAssetUrl,
  compareVersions,
  normalizeVersion,
  parseChecksums,
  selectReleaseAsset,
  supportedPlatformTarget,
} from "../src/update/core.js";

describe("update core", () => {
  test("normalizes and compares numeric stable semantic versions", () => {
    expect(normalizeVersion("v0.2.1")).toBe("0.2.1");
    expect(normalizeVersion("0.2.1")).toBe("0.2.1");
    expect(compareVersions("0.2.1", "0.2.10")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.2")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(() => normalizeVersion("0.2.1-beta.1")).toThrow("stable x.y.z");
  });

  test("detects supported Helix platform targets", () => {
    expect(supportedPlatformTarget({ platform: "darwin", arch: "arm64" })).toBe("darwin-arm64");
    expect(supportedPlatformTarget({ platform: "darwin", arch: "x64" })).toBe("darwin-x64");
    expect(supportedPlatformTarget({ platform: "linux", arch: "arm64" })).toBe("linux-arm64");
    expect(supportedPlatformTarget({ platform: "linux", arch: "x64" })).toBe("linux-x64");
    expect(() => supportedPlatformTarget({ platform: "win32", arch: "x64" })).toThrow("unsupported");
    expect(() => supportedPlatformTarget({ platform: "linux", arch: "ia32" })).toThrow("unsupported");
  });

  test("selects a release asset and parses checksum entries defensively", () => {
    const release = {
      tag_name: "v0.2.2",
      prerelease: false,
      assets: [
        { name: "helix-darwin-arm64", browser_download_url: "https://example.test/helix-darwin-arm64" },
        { name: "helix-darwin-x64", browser_download_url: "https://example.test/helix-darwin-x64" },
        { name: "checksums.txt", browser_download_url: "https://example.test/checksums.txt" },
      ],
    };
    expect(selectReleaseAsset(release, "darwin-arm64")).toEqual(release.assets[0]);
    expect(() => selectReleaseAsset(release, "linux-arm64")).toThrow("missing");
    expect(() => assertTrustedAssetUrl("https://example.test/helix-darwin-arm64")).toThrow("unexpected download URL");

    const checksums = parseChecksums("a".repeat(64) + "  helix-darwin-arm64\n" + "b".repeat(64) + "  helix-linux-x64\n");
    expect(checksums.get("helix-darwin-arm64")).toBe("a".repeat(64));
    expect(checksums.get("helix-linux-x64")).toBe("b".repeat(64));
    expect(() => parseChecksums("not-a-checksum  helix-darwin-arm64\n")).toThrow("invalid");
    expect(() => parseChecksums(`${"a".repeat(64)}  ../helix-darwin-arm64\n`)).toThrow("invalid");
  });
});
