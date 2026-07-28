import { describe, expect, test } from "bun:test";
import { clearConversationLog, terminalGeometry } from "../src/tui/screens/chat.js";
import { settleOwnedRequest } from "../src/tui/conversation.js";

describe("TUI refinement helpers", () => {
  test("abort settlement preserves partial output until one pending clear removes the owned conversation", () => {
    const owner = {};
    expect(settleOwnedRequest({}, owner, { aborted: true, hasOutput: true, hasError: false, pendingClear: true })).toBeNull();
    expect(settleOwnedRequest(owner, owner, { aborted: true, hasOutput: true, hasError: false, pendingClear: false })).toEqual({
      state: "stopped",
      removeAssistant: false,
      clearConversation: false,
      showError: false,
      status: "Stopped",
    });
    expect(settleOwnedRequest(owner, owner, { aborted: true, hasOutput: true, hasError: false, pendingClear: true })).toEqual({
      state: "stopped",
      removeAssistant: false,
      clearConversation: true,
      showError: false,
      status: "Chat cleared",
    });

    const log = [
      { role: "notice", content: "Ready" },
      { role: "user", content: "question" },
      { role: "assistant", content: "partial" },
    ];
    expect(clearConversationLog(log)).toEqual([{ role: "notice", content: "Ready" }]);
  });

  test("failed empty output is removed and a provider error remains visible", () => {
    const owner = {};
    expect(settleOwnedRequest(owner, owner, { aborted: false, hasOutput: false, hasError: true, pendingClear: false })).toEqual({
      state: "failed",
      removeAssistant: true,
      clearConversation: false,
      showError: true,
      status: "Idle",
    });
  });

  test("narrow and short terminal geometry never expands beyond usable terminal dimensions", () => {
    expect(terminalGeometry(10, 4)).toEqual({ width: 10, height: 4, innerWidth: 8 });
    expect(terminalGeometry(3, 1)).toEqual({ width: 3, height: 1, innerWidth: 1 });
    expect(terminalGeometry(2, 1)).toEqual({ width: 2, height: 1, innerWidth: 0 });
    expect(terminalGeometry(80, 0)).toEqual({ width: 80, height: 1, innerWidth: 78 });
  });
});
