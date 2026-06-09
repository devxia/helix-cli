import { matchesKey, ProcessTerminal, TUI } from "@earendil-works/pi-tui";
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

      if (this.chat.handleInterrupt()) {
        return { consume: true };
      }

      this.tui.stop();
      process.exit(0);
    });

    this.tui.start();
  }
}
