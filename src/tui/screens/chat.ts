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
  type ModelDef,
  type ProviderConfig,
  getActiveProvider,
  getAvailableModels,
  hasCredentials,
  refreshProviderModels,
  loadConfig,
  resolveCredentials,
  resolveThinkingPreference,
  setCatalogProviderModels,
} from "../../config.js";
import { type CommandContext, registry } from "../../commands/index.js";
import { executeProviderCommand } from "../../commands/provider.js";
import { executeModelCommand } from "../../commands/model.js";
import { preloadCatalogModels } from "../../catalog.js";
import { createLLMProvider } from "../../llm/factory.js";
import type { LLMProvider } from "../../llm/provider.js";
import { providerIcon } from "../../utils/icons.js";
import { RESET, DIM, BOLD, CYAN, GREEN, RED, YELLOW } from "../../utils/ansi.js";
import { buildConversation, settleOwnedRequest, type ConversationLogItem } from "../conversation.js";

type NoticeMessage = Extract<ConversationLogItem, { role: "notice" }>;
type UserMessage = Extract<ConversationLogItem, { role: "user" }>;
type AssistantMessage = Extract<ConversationLogItem, { role: "assistant" }> & { thinkingExpanded?: boolean };
type ChatMessage = NoticeMessage | UserMessage | AssistantMessage;
type ActiveRequest = { controller: AbortController; assistant: AssistantMessage };

export function clearConversationLog<T extends { role: string }>(messages: readonly T[]): T[] {
  return messages.filter((message) => message.role === "notice");
}

export function terminalGeometry(columns: number, rows: number): { width: number; height: number; innerWidth: number } {
  const width = Math.max(1, Math.floor(columns));
  return { width, height: Math.max(1, Math.floor(rows)), innerWidth: Math.max(0, width - 2) };
}

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
  private provider: LLMProvider | null = null;
  private model = "";
  private messages: ChatMessage[] = [{ role: "notice", content: "Ready. Type a message and press Enter." }];
  private activeRequest: ActiveRequest | null = null;
  private exitOnNextInterrupt = false;
  private status = "Idle";
  private showHelpOverlay = false;
  private pendingClear = false;
  private inputHistory: string[] = [];
  private inputHistoryIndex = -1;
  private commandComponent: Component | null = null;

  constructor(private readonly tui: TUI) {
    this.applyConfiguredProvider();
    const anyReady = Object.values(loadConfig().providers).some(hasCredentials);
    if (!anyReady) {
      this.messages = [
        { role: "notice", content: `${CYAN}Welcome to Helix CLI!${RESET}` },
        { role: "notice", content: `No provider credentials configured yet.` },
        { role: "notice", content: `Type ${GREEN}/provider${RESET} to select and configure a provider.` },
      ];
      this.status = "No provider — type /provider";
    }

    this.editor = new Editor(tui, editorTheme, { paddingX: 1 });
    this.editor.onSubmit = (text) => { void this.handleSubmit(text); };
    registry.register({ name: "provider", description: "Configure or switch LLM provider", execute: executeProviderCommand });
    registry.register({ name: "model", description: "Select provider/model and Thinking state", execute: executeModelCommand });

    const config = loadConfig();
    if (config.active_provider) void refreshProviderModels(config.active_provider);
    void preloadCatalogModels().then((catalog) => {
      for (const [providerId, models] of catalog) setCatalogProviderModels(providerId, models);
    });

    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(
      registry.list().map((command) => ({ name: command.name, description: command.description })),
      process.cwd(),
    ));
  }

  isStreaming(): boolean { return this.activeRequest !== null; }

  private applyConfiguredProvider(): void {
    const config = loadConfig();
    const provider = getActiveProvider();
    this.model = process.env.HELIX_MODEL || config.active_model || "";
    if (!provider || !hasCredentials(provider)) { this.provider = null; return; }
    try { this.provider = createLLMProvider(config.active_provider!, provider, resolveCredentials(provider)); }
    catch { this.provider = null; }
  }

  private activeModelDef(providerId: string, modelId: string): ModelDef {
    return getAvailableModels(providerId).find((model) => model.id === modelId) ?? {
      id: modelId,
      label: modelId,
      reasoning: { availability: "none", persistence: "none" },
      reasoningKnown: false,
      context: 8_000,
    };
  }

  private getCommandContext(): CommandContext {
    return {
      showComponent: (component) => { this.commandComponent = component; this.tui.setFocus(this); this.tui.requestRender(true); },
      done: () => { this.commandComponent = null; this.tui.requestRender(true); },
      addNotice: (text) => { this.messages.push({ role: "notice", content: text }); },
      applyProvider: () => {
        this.applyConfiguredProvider();
        const providerId = loadConfig().active_provider;
        if (providerId) void refreshProviderModels(providerId);
      },
    };
  }

  handleInterrupt(): boolean {
    if (this.activeRequest) {
      this.activeRequest.controller.abort();
      this.exitOnNextInterrupt = true;
      this.status = "Stopping...";
      this.tui.requestRender(true);
      return true;
    }
    if (this.exitOnNextInterrupt) return false;
    this.exitOnNextInterrupt = true;
    this.status = "Press Ctrl+C again to exit.";
    this.tui.requestRender(true);
    return true;
  }

  clearChat(): void {
    if (this.activeRequest) {
      this.pendingClear = true;
      this.activeRequest.controller.abort();
      this.status = "Stopping...";
      this.tui.requestRender(true);
      return;
    }
    this.messages = clearConversationLog(this.messages);
    this.status = "Chat cleared";
    this.tui.requestRender(true);
  }

  toggleHelpOverlay(): void { this.showHelpOverlay = !this.showHelpOverlay; this.tui.requestRender(true); }
  toggleLastThinkingExpansion(): void {
    for (let index = this.messages.length - 1; index >= 0; index--) {
      const message = this.messages[index];
      if (message?.role === "assistant" && message.thinking) {
        message.thinkingExpanded = !message.thinkingExpanded;
        this.tui.requestRender(true);
        return;
      }
    }
  }

  handleInput(data: string): void {
    if (this.commandComponent?.handleInput) { this.commandComponent.handleInput(data); this.tui.requestRender(); return; }
    this.exitOnNextInterrupt = false;
    if (!this.activeRequest && this.status === "Press Ctrl+C again to exit.") this.status = "Idle";
    if (matchesKey(data, "alt+up")) { this.cycleInputHistory(-1); return; }
    if (matchesKey(data, "alt+down")) { this.cycleInputHistory(1); return; }
    this.editor.handleInput(data);
  }

  private cycleInputHistory(direction: -1 | 1): void {
    if (!this.inputHistory.length) return;
    const next = this.inputHistoryIndex + direction;
    if (next < -1 || next >= this.inputHistory.length) return;
    this.inputHistoryIndex = next;
    this.editor.setText(this.inputHistory[next] ?? "");
    this.tui.requestRender(true);
  }

  invalidate(): void { this.editor.invalidate(); this.commandComponent?.invalidate(); }

  render(width: number): string[] {
    const geometry = terminalGeometry(width, this.tui.terminal.rows);
    const safeWidth = geometry.width;
    const height = geometry.height;
    const innerWidth = geometry.innerWidth;
    if (safeWidth < 3) return [truncateToWidth("H", safeWidth, "", false)].slice(0, height);
    const inputLines = this.commandComponent
      ? this.commandComponent.render(innerWidth)
      : this.editor.render(innerWidth).slice(0, Math.max(3, Math.floor(height * 0.5)));
    const messageRows = Math.max(1, height - 5 - inputLines.length);
    const display = this.showHelpOverlay ? this.renderHelpOverlay(messageRows) : this.renderMessages(innerWidth, messageRows);
    const lines = [this.topBorder(safeWidth), this.frameLine(`${GREEN}Helix Cli v0.0.2${RESET}`, innerWidth), this.separator(safeWidth, this.showHelpOverlay ? " Help " : " Messages ")];
    for (const line of display) lines.push(this.frameLine(line, innerWidth));
    lines.push(this.separator(safeWidth, this.commandComponent ? " Command " : " Input "));
    for (const line of inputLines) lines.push(this.frameLine(line, innerWidth));

    const config = loadConfig();
    const provider = getActiveProvider();
    const ready = provider ? hasCredentials(provider) : false;
    const info = provider && config.active_provider
      ? ready
        ? `${DIM}${providerIcon(config.active_provider)} ${provider.name} · ${this.model}${RESET}`
        : `${DIM}${providerIcon(config.active_provider)} ${provider.name}${RESET} ${YELLOW}(credentials missing)${RESET}`
      : `${DIM}No configured provider${RESET} ${YELLOW}(type /provider)${RESET}`;
    lines.push(this.frameLine(info, innerWidth));
    lines.push(this.bottomBorder(safeWidth, this.status));
    return lines.slice(0, height);
  }

  private async handleSubmit(text: string): Promise<void> {
    const input = text.trim();
    if (!input || this.activeRequest || this.commandComponent) return;
    const command = registry.parse(input);
    if (command) {
      this.editor.setText("");
      command.execute(this.getCommandContext());
      this.tui.requestRender(true);
      return;
    }

    const config = loadConfig();
    const providerConfig = config.active_provider ? config.providers[config.active_provider] : undefined;
    const adapter = this.provider;
    const providerId = config.active_provider;
    const modelId = process.env.HELIX_MODEL || config.active_model || this.model;
    if (!providerConfig || !providerId || !adapter || !modelId || !hasCredentials(providerConfig)) {
      this.messages.push({ role: "notice", content: `${RED}No ready provider/model. Use /provider and /model first.${RESET}` });
      this.tui.requestRender(true);
      return;
    }
    const model = this.activeModelDef(providerId, modelId);
    const preference = resolveThinkingPreference(providerId, model);

    this.exitOnNextInterrupt = false;
    this.editor.addToHistory(input);
    this.inputHistory.unshift(input);
    this.inputHistoryIndex = -1;
    this.editor.setText("");
    this.messages.push({ role: "user", content: input });
    const conversation = buildConversation(this.messages, { contextLimit: model.context, thinkingPersistence: model.reasoning.persistence });
    if (!conversation.ok) {
      this.messages.push({ role: "notice", content: `${RED}Error:${RESET} ${conversation.error}` });
      this.status = "Input rejected locally";
      this.tui.requestRender(true);
      return;
    }

    const assistant: AssistantMessage = { role: "assistant", content: "", state: "pending", thinkingExpanded: true };
    this.messages.push(assistant);
    const owner: ActiveRequest = { controller: new AbortController(), assistant };
    this.activeRequest = owner;
    this.status = "Streaming...";
    this.tui.requestRender(true);
    let errorMessage: string | undefined;

    try {
      const stream = adapter.stream({
        messages: conversation.messages,
        options: { model: modelId, thinking: model.reasoning.availability === "none" ? undefined : preference },
        signal: owner.controller.signal,
      });
      for await (const event of stream) {
        if (this.activeRequest !== owner || owner.controller.signal.aborted) break;
        if (event.type === "content") {
          if (event.part.type === "think") {
            assistant.thinking = (assistant.thinking ?? "") + event.part.think;
            this.status = "Thinking...";
          } else {
            assistant.content += event.part.text;
            this.status = "Streaming...";
          }
          this.tui.requestRender();
        } else if (event.type === "error") {
          errorMessage = event.error.message;
        }
      }
    } catch (error) {
      if (!owner.controller.signal.aborted) errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      const settlement = settleOwnedRequest(this.activeRequest, owner, {
        aborted: owner.controller.signal.aborted,
        hasOutput: !!assistant.content || !!assistant.thinking,
        hasError: !!errorMessage,
        pendingClear: this.pendingClear,
      });
      if (settlement) {
        assistant.state = settlement.state;
        if (settlement.removeAssistant) {
          const index = this.messages.indexOf(assistant);
          if (index >= 0) this.messages.splice(index, 1);
        }
        if (settlement.showError) this.messages.push({ role: "notice", content: `${RED}Error:${RESET} ${errorMessage}` });
        this.activeRequest = null;
        if (settlement.clearConversation) {
          this.messages = clearConversationLog(this.messages);
          this.pendingClear = false;
        }
        this.status = settlement.status;
      }
      this.tui.requestRender(true);
    }
  }

  private renderHelpOverlay(maxRows: number): string[] {
    const lines = [
      ` ${BOLD}Global shortcuts${RESET}`, "",
      ` ${CYAN}Esc${RESET}        Interrupt streaming`,
      ` ${CYAN}Ctrl+L${RESET}     Clear chat`,
      ` ${CYAN}Ctrl+T${RESET}     Toggle latest Thinking display`,
      ` ${CYAN}Ctrl+/${RESET}     Toggle this help overlay`, "",
      ` ${BOLD}Slash commands${RESET}`, "",
      ` ${GREEN}/provider${RESET}  Configure or switch provider`,
      ` ${GREEN}/model${RESET}     Select provider/model and Thinking`, "",
      ` ${DIM}Press Ctrl+/ to close${RESET}`,
    ];
    while (lines.length < maxRows) lines.push("");
    return lines.slice(0, maxRows);
  }

  private renderMessages(width: number, maxRows: number): string[] {
    const rendered: string[] = [];
    for (const message of this.messages) {
      if (message.role === "assistant" && message.thinking) {
        if (message.thinkingExpanded !== false) {
          for (const line of wrapTextWithAnsi(`${DIM}${YELLOW}> ${RESET}${DIM}${message.thinking}${RESET}`, Math.max(1, width - 2))) rendered.push(` ${line}`);
          rendered.push("");
        } else {
          rendered.push(` ${DIM}[Thinking hidden — press ${YELLOW}Ctrl+T${RESET}${DIM} to expand]${RESET}`);
          rendered.push("");
        }
      }
      const prefix = message.role === "user" ? "You: " : message.role === "assistant" ? "Helix: " : DIM;
      const body = message.role === "assistant" && !message.content
        ? message.state === "pending" ? `${DIM}…${RESET}` : ""
        : message.content;
      if (body) for (const line of wrapTextWithAnsi(`${prefix}${body}`, Math.max(1, width - 2))) rendered.push(` ${line}`);
      if (message.role === "assistant" && message.state === "stopped") rendered.push(` ${DIM}[stopped]${RESET}`);
    }
    const visible = rendered.slice(-maxRows);
    while (visible.length < maxRows) visible.unshift("");
    return visible;
  }

  private topBorder(width: number): string { return `┌${"─".repeat(width - 2)}┐`; }
  private separator(width: number, label: string): string {
    const visibleLabel = truncateToWidth(label, Math.max(1, width - 2), "", false);
    const remaining = Math.max(0, width - visibleWidth(visibleLabel) - 2);
    const left = Math.floor(remaining / 2);
    return `├${"─".repeat(left)}${visibleLabel}${"─".repeat(remaining - left)}┤`;
  }
  private bottomBorder(width: number, status: string): string {
    const label = ` ${status} `;
    return `└${"─".repeat(Math.max(0, width - visibleWidth(label) - 2))}${truncateToWidth(label, width - 2, "", false)}┘`;
  }
  private frameLine(content: string, width: number): string {
    const line = truncateToWidth(content, width, "...", true);
    return `│${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}│`;
  }
}
