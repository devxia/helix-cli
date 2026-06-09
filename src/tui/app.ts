import { isKeyRelease, matchesKey, ProcessTerminal, TUI } from "@earendil-works/pi-tui";
import { ChatScreen } from "./screens/chat.js";

export class HelixApp {
  private readonly tui: TUI;
  private readonly chat: ChatScreen;

  constructor() {
    this.tui = new TUI(new ProcessTerminal(), true);
    this.chat = new ChatScreen(this.tui);
  }

  async start(): Promise<void> {
    this.tui.addChild(this.chat);
    this.tui.setFocus(this.chat);
    this.tui.terminal.setTitle("Helix Cli");

    this.tui.addInputListener((data) => {
      if (!matchesKey(data, "ctrl+c")) {
        return;
      }

      // Filter out key release events — Kitty keyboard protocol reports both
      // press and release, but we only want to act on the press.
      if (isKeyRelease(data)) {
        return { consume: true };
      }

      if (this.chat.handleInterrupt()) {
        return { consume: true };
      }

      this.tui.stop();
      process.exit(0);
    });

    this.tui.start();
  }
}
