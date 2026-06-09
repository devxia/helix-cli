import {
  Editor,
  type EditorTheme,
  type Focusable,
  type Component,
  TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import OpenAI from "openai";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

const editorTheme: EditorTheme = {
  borderColor: (text) => `${CYAN}${text}${RESET}`,
  selectList: {
    selectedPrefix: (text) => `${CYAN}${text}${RESET}`,
    selectedText: (text) => `${CYAN}${text}${RESET}`,
    description: (text) => `${DIM}${text}${RESET}`,
    scrollInfo: (text) => `${DIM}${text}${RESET}`,
    noMatch: (text) => `${DIM}${text}${RESET}`,
  },
};

export class ChatScreen implements Component, Focusable {
  focused = false;

  private readonly editor: Editor;
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
  private readonly messages: ChatMessage[] = [
    {
      role: "system",
      content: "Ready. Type a message and press Enter.",
    },
  ];
  private activeRequest: AbortController | null = null;
  private exitOnNextInterrupt = false;
  private status = "Idle";

  constructor(private readonly tui: TUI) {
    this.client = new OpenAI({
      apiKey: process.env.KIMI_API_KEY,
      baseURL: process.env.KIMI_BASE_URL || "https://api.moonshot.cn/v1",
      defaultHeaders: {
        "User-Agent": "KimiCLI/1.5",
      },
    });
    this.model = process.env.KIMI_MODEL || "kimi-k2";

    this.editor = new Editor(tui, editorTheme, { paddingX: 1 });
    this.editor.onSubmit = (text) => {
      void this.handleSubmit(text);
    };
  }

  handleInterrupt(): boolean {
    if (this.activeRequest) {
      this.activeRequest.abort();
      this.activeRequest = null;
      this.exitOnNextInterrupt = true;
      this.status = "Stopped. Press Ctrl+C again to exit.";
      this.tui.requestRender(true);
      return true;
    }

    if (this.exitOnNextInterrupt) {
      return false;
    }

    this.exitOnNextInterrupt = true;
    this.status = "Press Ctrl+C again to exit.";
    this.tui.requestRender(true);
    return true;
  }

  handleInput(data: string): void {
    this.exitOnNextInterrupt = false;
    if (!this.activeRequest && this.status === "Press Ctrl+C again to exit.") {
      this.status = "Idle";
    }
    this.editor.handleInput(data);
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(24, width);
    const height = Math.max(10, this.tui.terminal.rows);
    const innerWidth = safeWidth - 2;
    const editorLines = this.editor.render(innerWidth).slice(0, Math.max(3, Math.floor(height * 0.3)));
    const fixedRows = 5 + editorLines.length;
    const messageRows = Math.max(1, height - fixedRows);
    const messageLines = this.renderMessages(innerWidth, messageRows);
    const lines: string[] = [];

    lines.push(this.topBorder(safeWidth));
    lines.push(this.frameLine(`${GREEN}Helix Cli v0.0.2${RESET}`, innerWidth));
    lines.push(this.separator(safeWidth, " Messages "));

    for (const line of messageLines) {
      lines.push(this.frameLine(line, innerWidth));
    }

    lines.push(this.separator(safeWidth, " Input "));

    for (const line of editorLines) {
      lines.push(this.frameLine(line, innerWidth));
    }

    lines.push(this.bottomBorder(safeWidth, this.status));

    return lines.slice(0, height);
  }

  private async handleSubmit(text: string): Promise<void> {
    const input = text.trim();
    if (!input || this.activeRequest) {
      return;
    }

    this.exitOnNextInterrupt = false;
    this.editor.addToHistory(input);
    this.editor.setText("");
    this.conversation.push({ role: "user", content: input });
    this.messages.push({ role: "user", content: input });
    this.messages.push({ role: "assistant", content: "" });
    this.status = "Streaming...";
    this.tui.requestRender(true);

    const controller = new AbortController();
    this.activeRequest = controller;

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: this.conversation,
          stream: true,
        },
        {
          signal: controller.signal,
        },
      );

      let reply = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || "";
        if (!delta) {
          continue;
        }

        reply += delta;
        this.updateLastAssistantMessage(reply);
        this.tui.requestRender();
      }

      if (!controller.signal.aborted) {
        this.conversation.push({ role: "assistant", content: reply });
        this.status = "Idle";
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        this.updateLastAssistantMessage("[stopped]");
      } else {
        this.messages.push({
          role: "system",
          content: `${RED}Error:${RESET} ${(err as Error).message}`,
        });
      }
    } finally {
      this.activeRequest = null;
      if (this.status === "Streaming...") {
        this.status = "Idle";
      }
      this.tui.requestRender(true);
    }
  }

  private updateLastAssistantMessage(content: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant") {
      last.content = content;
    }
  }

  private renderMessages(width: number, maxRows: number): string[] {
    const rendered: string[] = [];

    for (const message of this.messages) {
      const prefix = this.messagePrefix(message.role);
      const wrapped = wrapTextWithAnsi(`${prefix}${message.content || " "}`, Math.max(1, width - 2));
      for (const line of wrapped) {
        rendered.push(` ${line}`);
      }
    }

    const visible = rendered.slice(-maxRows);
    while (visible.length < maxRows) {
      visible.unshift("");
    }

    return visible;
  }

  private messagePrefix(role: ChatMessage["role"]): string {
    if (role === "user") {
      return "You: ";
    }
    if (role === "assistant") {
      return "Helix: ";
    }
    return `${DIM}`;
  }

  private topBorder(width: number): string {
    return `┌${"─".repeat(width - 2)}┐`;
  }

  private separator(width: number, label: string): string {
    const labelWidth = visibleWidth(label);
    const remaining = Math.max(0, width - labelWidth - 2);
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return `├${"─".repeat(left)}${label}${"─".repeat(right)}┤`;
  }

  private bottomBorder(width: number, status: string): string {
    const label = ` ${status} `;
    const labelWidth = visibleWidth(label);
    const remaining = Math.max(0, width - labelWidth - 2);
    return `└${"─".repeat(remaining)}${truncateToWidth(label, width - 2, "", false)}┘`;
  }

  private frameLine(content: string, width: number): string {
    const line = truncateToWidth(content, width, "...", true);
    const padding = " ".repeat(Math.max(0, width - visibleWidth(line)));
    return `│${line}${padding}│`;
  }
}
