import {
  Editor,
  type EditorTheme,
  type Focusable,
  type Component,
  TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  CombinedAutocompleteProvider,
  matchesKey,
} from "@earendil-works/pi-tui";
import {
  type ProviderConfig,
  getActiveProvider,
  getActiveModel,
  getAvailableModels,
  hasApiKey,
  isThinkingEnabled,
  refreshProviderModels,
  loadConfig,
  resolveApiKey,
  resolveBaseUrl,
  setProviderModels,
} from "../../config.js";
import { type CommandContext, registry } from "../../commands/index.js";
import { executeProviderCommand } from "../../commands/provider.js";
import { executeModelCommand } from "../../commands/model.js";
import { preloadCatalogModels } from "../../catalog.js";
import { createLLMProvider } from "../../llm/factory.js";
import type { LLMProvider } from "../../llm/provider.js";
import type { LLMEvent } from "../../llm/types.js";
import { providerIcon } from "../../utils/icons.js";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  thinkingExpanded?: boolean;
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

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
  private provider: LLMProvider;
  private model: string;
  private readonly conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
  private messages: ChatMessage[] = [
    {
      role: "system",
      content: "Ready. Type a message and press Enter.",
    },
  ];
  private activeRequest: AbortController | null = null;
  private exitOnNextInterrupt = false;
  private status = "Idle";
  private showHelpOverlay = false;
  /** Separate input history so Alt+↑/↓ works even inside multi-line input. */
  private inputHistory: string[] = [];
  private inputHistoryIndex = -1;
  /** When set, the editor is replaced by a command UI component. */
  private commandComponent: Component | null = null;

  constructor(private readonly tui: TUI) {
    this.provider = this.createProvider();
    this.model = this.resolveModel();

    // If no provider has a key, show setup guidance
    const anyKeyConfigured = Object.entries(loadConfig().providers as Record<string, ProviderConfig>).some(
      ([id, p]) => hasApiKey(id, p),
    );
    if (!anyKeyConfigured) {
      this.messages = [
        { role: "system", content: `${CYAN}Welcome to Helix CLI!${RESET}` },
        { role: "system", content: `No API key configured yet.` },
        { role: "system", content: `Type ${GREEN}/provider${RESET} to set up an LLM provider and start chatting.` },
      ];
      this.status = "No API key — type /provider to get started";
    }

    this.editor = new Editor(tui, editorTheme, { paddingX: 1 });
    this.editor.onSubmit = (text) => {
      void this.handleSubmit(text);
    };

    // -- Register slash commands -------------------------------------------
    registry.register({
      name: "provider",
      description: "Select an LLM provider and enter API key",
      execute: (ctx) => executeProviderCommand(ctx),
    });
    registry.register({
      name: "model",
      description: "Select model and toggle thinking mode",
      execute: (ctx) => executeModelCommand(ctx),
    });

    // Fetch fresh model list from provider API in the background
    const providerId = loadConfig().active_provider;
    refreshProviderModels(providerId);

    // Pre-populate models from catalog cache (fast, no network needed)
    preloadCatalogModels().then((catalogModels) => {
      for (const [pid, models] of catalogModels) {
        setProviderModels(pid, models);
      }
    });

    // Wire up slash-command autocomplete
    const slashCommands = registry.list().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
    this.editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(slashCommands, process.cwd()),
    );
  }

  // -- Provider helpers ----------------------------------------------------

  private thinkingEnabled(): boolean {
    return isThinkingEnabled();
  }

  /** Whether the *currently active model* advertises reasoning support. */
  private currentModelSupportsThinking(): boolean {
    const providerId = loadConfig().active_provider;
    const models = getAvailableModels(providerId);
    const current = models.find((m) => m.id === this.model);
    return current?.reasoning === true;
  }



  private createProvider(): LLMProvider {
    const provider = getActiveProvider();
    const providerId = loadConfig().active_provider;
    const apiKey = resolveApiKey(providerId, provider);
    const baseURL = resolveBaseUrl(providerId, provider);

    // Use a placeholder key when none is set so the TUI can start; real auth
    // errors surface when the user sends their first message.
    return createLLMProvider(providerId, provider, apiKey, baseURL);
  }

  private resolveModel(): string {
    const envModel = process.env.KIMI_MODEL;
    if (envModel) return envModel;

    const providerId = loadConfig().active_provider;
    const envModelMap: Record<string, string | undefined> = {
      openai: process.env.OPENAI_MODEL,
      anthropic: process.env.ANTHROPIC_MODEL,
      "google-genai": process.env.GOOGLE_MODEL,
      vertexai: process.env.GOOGLE_MODEL,
      kimi: process.env.KIMI_MODEL,
    };
    return envModelMap[providerId] || getActiveModel();
  }

  private resolveProvider() {
    const providerId = loadConfig().active_provider;
    const provider = getActiveProvider();
    const apiKey = resolveApiKey(providerId, provider);
    const baseUrl = resolveBaseUrl(providerId, provider);
    return {
      name: provider.name,
      base_url: baseUrl,
      api_key: apiKey,
    };
  }

  // -- CommandContext implementation ---------------------------------------

  private getCommandContext(): CommandContext {
    return {
      showComponent: (component) => {
        this.commandComponent = component;
        this.tui.setFocus(this);
        this.tui.requestRender(true);
      },
      done: () => {
        this.commandComponent = null;
        this.tui.requestRender(true);
      },
      addSystemMessage: (text) => {
        this.messages.push({ role: "system", content: text });
      },
      applyProvider: () => {
        this.provider = this.createProvider();
        this.model = this.resolveModel();
        // Refresh model list for the new provider
        const providerId = loadConfig().active_provider;
        refreshProviderModels(providerId);
      },
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

  clearChat(): void {
    // Keep only the initial system welcome message(s)
    this.messages = this.messages.filter((m) => m.role === "system");
    this.conversation.length = 0;
    this.status = "Chat cleared";
    this.tui.requestRender(true);
  }

  toggleHelpOverlay(): void {
    this.showHelpOverlay = !this.showHelpOverlay;
    this.tui.requestRender(true);
  }

  handleInput(data: string): void {
    if (this.commandComponent?.handleInput) {
      this.commandComponent.handleInput(data);
      this.tui.requestRender();
      return;
    }

    this.exitOnNextInterrupt = false;
    if (!this.activeRequest && this.status === "Press Ctrl+C again to exit.") {
      this.status = "Idle";
    }

    // Toggle thinking expansion for the last assistant message
    if (data === "t" && !this.commandComponent && !this.activeRequest) {
      this.toggleLastThinkingExpansion();
      return;
    }

    // Alt+↑/↓ cycle input history even inside multi-line input
    if (matchesKey(data, "alt+up")) {
      this.cycleInputHistory(-1);
      return;
    }
    if (matchesKey(data, "alt+down")) {
      this.cycleInputHistory(1);
      return;
    }

    this.editor.handleInput(data);
  }

  private cycleInputHistory(direction: -1 | 1): void {
    if (this.inputHistory.length === 0) return;

    const nextIndex = this.inputHistoryIndex + direction;
    if (nextIndex < -1 || nextIndex >= this.inputHistory.length) return;

    this.inputHistoryIndex = nextIndex;
    const text = this.inputHistory[this.inputHistoryIndex] ?? "";
    this.editor.setText(text);
    this.tui.requestRender(true);
  }

  private toggleLastThinkingExpansion(): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role === "assistant" && m.thinking) {
        m.thinkingExpanded = !m.thinkingExpanded;
        this.tui.requestRender(true);
        return;
      }
    }
  }

  invalidate(): void {
    this.editor.invalidate();
    this.commandComponent?.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(24, width);
    const height = Math.max(10, this.tui.terminal.rows);
    const innerWidth = safeWidth - 2;

    // Command mode: swap editor for command UI
    let inputLines: string[];
    let inputLabel = " Input ";
    if (this.commandComponent) {
      inputLines = this.commandComponent.render(innerWidth);
      inputLabel = " Command ";
    } else {
      const maxInputRows = Math.max(3, Math.floor(height * 0.5));
      inputLines = this.editor.render(innerWidth).slice(0, maxInputRows);
    }

    const fixedRows = 5 + inputLines.length;
    const messageRows = Math.max(1, height - fixedRows);
    const messageLines = this.renderMessages(innerWidth, messageRows);
    const displayLines = this.showHelpOverlay
      ? this.renderHelpOverlay(innerWidth, messageRows)
      : messageLines;
    const lines: string[] = [];

    lines.push(this.topBorder(safeWidth));
    lines.push(this.frameLine(`${GREEN}Helix Cli v0.0.2${RESET}`, innerWidth));
    lines.push(this.separator(safeWidth, this.showHelpOverlay ? " Help " : " Messages "));

    for (const line of displayLines) {
      lines.push(this.frameLine(line, innerWidth));
    }

    lines.push(this.separator(safeWidth, inputLabel));

    for (const line of inputLines) {
      lines.push(this.frameLine(line, innerWidth));
    }

    // Model info line — show provider or hint to set one up
    const provider = getActiveProvider();
    const providerId = loadConfig().active_provider;
    const providerHasKey = hasApiKey(providerId, provider);
    const typeIcon = providerIcon(providerId);
    const model = this.model;
    const showThinking = this.thinkingEnabled() && this.currentModelSupportsThinking();
    const info = providerHasKey
      ? `${DIM}${typeIcon} ${provider.name} · ${model}${showThinking ? ` · 💭 thinking` : ""}${RESET}`
      : `${DIM}${typeIcon} ${provider.name}${RESET}  ${YELLOW}(no API key — type /provider)${RESET}`;
    lines.push(this.frameLine(info, innerWidth));

    lines.push(this.bottomBorder(safeWidth, this.status));

    return lines.slice(0, height);
  }

  private async handleSubmit(text: string): Promise<void> {
    const input = text.trim();
    if (!input || this.activeRequest || this.commandComponent) {
      return;
    }

    // Slash command routing
    const cmd = registry.parse(input);
    if (cmd) {
      this.messages.push({ role: "user", content: input });
      cmd.execute(this.getCommandContext());
      this.tui.requestRender(true);
      return;
    }

    this.exitOnNextInterrupt = false;
    this.editor.addToHistory(input);
    this.inputHistory.unshift(input);
    this.inputHistoryIndex = -1;
    this.editor.setText("");
    this.conversation.push({ role: "user", content: input });
    this.messages.push({ role: "user", content: input });
    this.messages.push({ role: "assistant", content: "" });
    this.status = "Streaming...";
    this.tui.requestRender(true);

    const controller = new AbortController();
    this.activeRequest = controller;

    let reply = "";
    let thinking = "";
    let state: "thinking" | "answering" = "thinking";

    try {
      const stream = this.provider.stream({
        messages: this.toLLMMessages(this.conversation),
        options: {
          model: this.model,
          thinking: this.currentModelSupportsThinking() && this.thinkingEnabled(),
        },
      });

      for await (const event of stream) {
        if (controller.signal.aborted) break;
        this.handleLLMEvent(event);

        if (event.type === "content") {
          if (event.part.type === "think") {
            thinking += event.part.think;
            this.status = "Thinking...";
          } else {
            if (state === "thinking") {
              state = "answering";
            }
            reply += event.part.text;
            this.status = "Streaming...";
          }
          this.updateLastAssistantMessage(reply, thinking);
          this.tui.requestRender();
        } else if (event.type === "status") {
          // Could surface token usage in status line later.
        } else if (event.type === "error") {
          this.messages.push({
            role: "system",
            content: `${RED}Error:${RESET} ${event.error.message}`,
          });
        }
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
      if (this.status === "Streaming..." || this.status === "Thinking...") {
        this.status = "Idle";
      }
      this.tui.requestRender(true);
    }
  }

  private handleLLMEvent(_event: LLMEvent): void {
    // Hook for future handling (tool calls, subagent events, etc.)
  }

  private toLLMMessages(
    conversation: Array<{ role: "user" | "assistant"; content: string }>,
  ): Array<{ role: "user"; content: [{ type: "text"; text: string }] } | { role: "assistant"; content: [{ type: "text"; text: string }] }> {
    return conversation.map((m) => ({
      role: m.role,
      content: [{ type: "text" as const, text: m.content }],
    }));
  }

  private updateLastAssistantMessage(content: string, thinking?: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant") {
      last.content = content;
      if (thinking) {
        last.thinking = thinking;
      }
    }
  }

  private renderHelpOverlay(width: number, maxRows: number): string[] {
    const rendered: string[] = [];
    const add = (text: string) => rendered.push(` ${text}`);

    add(`${BOLD}Global shortcuts${RESET}`);
    add("");
    add(`${CYAN}Esc${RESET}        Interrupt streaming / exit confirmation`);
    add(`${CYAN}Ctrl+L${RESET}     Clear chat`);
    add(`${CYAN}Ctrl+/${RESET}     Toggle this help overlay`);
    add("");
    add(`${BOLD}Slash commands${RESET}`);
    add("");
    add(`${GREEN}/provider${RESET}  Configure or switch LLM provider`);
    add(`${GREEN}/model${RESET}     Select model and toggle thinking`);
    add("");
    add(`${DIM}Press Ctrl+/ to close${RESET}`);

    while (rendered.length < maxRows) rendered.push("");
    return rendered.slice(0, maxRows);
  }

  private renderMessages(width: number, maxRows: number): string[] {
    const rendered: string[] = [];
    const thinkPrefix = `${DIM}${YELLOW}> ${RESET}${DIM}`;
    const showThinking = this.thinkingEnabled() && this.currentModelSupportsThinking();

    for (const message of this.messages) {
      // Render thinking first (dimmed yellow) — only when thinking is enabled and not collapsed
      const thinkingExpanded = message.thinkingExpanded !== false;
      if (showThinking && message.role === "assistant" && message.thinking && thinkingExpanded) {
        const wrapped = wrapTextWithAnsi(
          `${thinkPrefix}${message.thinking}`,
          Math.max(1, width - 2),
        );
        for (const line of wrapped) {
          rendered.push(` ${line}`);
        }
        // Empty separator line between thinking and answer
        rendered.push("");
      } else if (showThinking && message.role === "assistant" && message.thinking && !thinkingExpanded) {
        rendered.push(` ${DIM}[thinking hidden — press ${YELLOW}t${RESET}${DIM} to expand]${RESET}`);
        rendered.push("");
      }

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
