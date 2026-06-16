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
      // Filter out key release events — Kitty keyboard protocol reports both
      // press and release, but we only want to act on the press.
      if (isKeyRelease(data)) {
        return { consume: true };
      }

      // Global shortcuts
      if (matchesKey(data, "ctrl+l")) {
        this.chat.clearChat();
        return { consume: true };
      }

      if (matchesKey(data, "ctrl+/")) {
        this.chat.toggleHelpOverlay();
        return { consume: true };
      }

      if (matchesKey(data, "ctrl+t")) {
        this.chat.toggleThinking();
        return { consume: true };
      }

      if (matchesKey(data, "ctrl+c")) {
        if (this.chat.handleInterrupt()) {
          return { consume: true };
        }

        this.tui.stop();
        process.exit(0);
      }

      // Esc is handled by ChatScreen; keep it there so slash commands can use it.
    });

    this.tui.start();
  }
}
