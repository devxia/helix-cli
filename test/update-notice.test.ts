import { describe, expect, test } from "bun:test";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { createUpdateNoticeExtension } from "../src/update/notice.js";
import { HELIX_VERSION } from "../src/paths.js";

function extensionFactory(extension: InlineExtension): any {
  return typeof extension === "function" ? extension : extension.factory;
}

describe("update notice extension", () => {
  test("notifies once per session only when a newer stable release exists", async () => {
    const notifications: string[] = [];
    let calls = 0;
    const handlers = new Map<string, any>();
    const extension = createUpdateNoticeExtension({
      fetchLatestVersion: async () => {
        calls += 1;
        return "0.99.0";
      },
    });
    extensionFactory(extension)({
      on(event: string, handler: any) {
        handlers.set(event, handler);
      },
    } as any);
    const context = {
      mode: "tui",
      ui: { notify(message: string, type?: string) { notifications.push(`${type}:${message}`); } },
    } as any;

    await handlers.get("session_start")({}, context);
    await handlers.get("session_start")({}, context);

    expect(calls).toBe(1);
    expect(notifications).toEqual([
      `info:Helix 0.99.0 is available (current ${HELIX_VERSION}). Run: helix update`,
    ]);
  });

  test("silently skips equal versions, failures, disabled env, and non-TUI modes", async () => {
    const previous = process.env.HELIX_NO_UPDATE_NOTICE;
    process.env.HELIX_NO_UPDATE_NOTICE = "1";
    try {
      let calls = 0;
      const notifications: string[] = [];
      const handlers = new Map<string, any>();
      extensionFactory(createUpdateNoticeExtension({
        fetchLatestVersion: async () => {
          calls += 1;
          return "0.99.0";
        },
      }))({ on(event: string, handler: any) { handlers.set(event, handler); } } as any);
      await handlers.get("session_start")({}, {
        mode: "tui",
        ui: { notify(message: string) { notifications.push(message); } },
      } as any);
      expect(calls).toBe(0);
      expect(notifications).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.HELIX_NO_UPDATE_NOTICE;
      else process.env.HELIX_NO_UPDATE_NOTICE = previous;
    }
  });
});
