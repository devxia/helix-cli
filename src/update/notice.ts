import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { compareVersions, normalizeVersion } from "./core.js";
import { HELIX_VERSION } from "../paths.js";

const NOTICE_TIMEOUT_MS = 3_000;
const LATEST_RELEASE_URL = "https://api.github.com/repos/devxia/helix-cli/releases/latest";

export interface UpdateNoticeOptions {
  readonly currentVersion?: string;
  readonly fetchLatestVersion?: (timeoutMs: number) => Promise<string>;
}

async function defaultFetchLatestVersion(timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      signal: controller.signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `helix/${HELIX_VERSION}`,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = await response.json() as { tag_name?: unknown; prerelease?: unknown };
    if (typeof parsed.tag_name !== "string" || parsed.prerelease === true) throw new Error("unexpected latest release");
    return parsed.tag_name;
  } finally {
    clearTimeout(timeout);
  }
}

export function createUpdateNoticeExtension(options: UpdateNoticeOptions = {}): InlineExtension {
  const currentVersion = options.currentVersion ?? HELIX_VERSION;
  const fetchLatestVersion = options.fetchLatestVersion ?? defaultFetchLatestVersion;
  let checked = false;
  return {
    name: "helix-update-notice",
    hidden: true,
    factory(pi) {
      pi.on("session_start", async (_event, ctx) => {
        if (checked || ctx.mode !== "tui" || process.env.HELIX_NO_UPDATE_NOTICE) return;
        checked = true;
        try {
          const latest = await fetchLatestVersion(NOTICE_TIMEOUT_MS);
          const latestNormalized = normalizeVersion(latest);
          if (compareVersions(latestNormalized, currentVersion) <= 0) return;
          ctx.ui.notify(`Helix ${latestNormalized} is available (current ${currentVersion}). Run: helix update`, "info");
        } catch {
          // Startup notices are opportunistic; an offline check must not affect the session.
        }
      });
    },
  };
}
