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
} from "@earendil-works/pi-tui";
import OpenAI from "openai";
import {
  getActiveProvider,
  getActiveModel,
  getAvailableModels,
  hasApiKey,
  isThinkingEnabled,
  refreshProviderModels,
  loadConfig,
  resolveApiKey,
  resolveBaseUrl,
} from "../../config.js";
import { type CommandContext, registry } from "../../commands/index.js";
import { executeProviderCommand } from "../../commands/provider.js";
import { executeModelCommand } from "../../commands/model.js";
import { preloadCatalogModels } from "../../catalog.js";
import { setProviderModels } from "../../config.js";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
};

/** Kimi API extends the standard delta with a reasoning_content field. */
interface DeltaWithReasoning {
  content?: string | null;
  reasoning_content?: string;
}

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
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
  private client: OpenAI;
  private model: string;
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
  /** When set, the editor is replaced by a command UI component. */
  private commandComponent: Component | null = null;

  constructor(private readonly tui: TUI) {
    this.client = this.createClient();
    this.model = this.resolveModel();

    // If no provider has a key, show setup guidance
    const anyKeyConfigured = Object.entries(loadConfig().providers).some(
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

  private providerIcon(providerId: string): string {
    const iconMap: Record<string, string> = {
      kimi: "🌙",
      "kimi-code": "💻",
      "moonshot-cn": "🌙",
      "moonshot-ai": "🌙",
      openai: "⚡",
      anthropic: "◈",
      "google-genai": "🔷",
      vertexai: "🔷",
      deepseek: "🔮",
      qwen: "🧩",
      siliconflow: "🌊",
      volcengine: "🌋",
      zhipu: "🔮",
      minimax: "🎯",
      yi: "✨",
      baichuan: "🏔️",
      mistral: "🌀",
      groq: "⚡",
      xai: "✖",
      togetherai: "🤝",
      fireworks: "🎆",
      openrouter: "🔀",
      perplexity: "🔍",
      cohere: "🔷",
      deepinfra: "🏗️",
      cerebras: "🧠",
    };
    return iconMap[providerId] ?? "⚡";
  }

  private createClient(): OpenAI {
    const provider = getActiveProvider();
    const providerId = loadConfig().active_provider;
    const apiKey = resolveApiKey(providerId, provider);
    const baseURL = resolveBaseUrl(providerId, provider);

    // TODO: anthropic and google-genai types need their own SDKs.
    // For now we use the OpenAI SDK for all types (it works for openai-compatible).
    // Use a placeholder key when none is set so the TUI can start; real auth
    // errors surface when the user sends their first message.
    // Kimi Code API requires a recognised Coding Agent User-Agent.
    const ua = providerId === "kimi-code" ? "KimiCLI/0.63" : "HelixCLI/1.5";
    return new OpenAI({
      apiKey: apiKey || "unset",
      baseURL,
      defaultHeaders: { "User-Agent": ua },
    });
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
        this.client = this.createClient();
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
    this.editor.handleInput(data);
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
      inputLines = this.editor.render(innerWidth).slice(0, Math.max(3, Math.floor(height * 0.3)));
    }

    const fixedRows = 5 + inputLines.length;
    const messageRows = Math.max(1, height - fixedRows);
    const messageLines = this.renderMessages(innerWidth, messageRows);
    const lines: string[] = [];

    lines.push(this.topBorder(safeWidth));
    lines.push(this.frameLine(`${GREEN}Helix Cli v0.0.2${RESET}`, innerWidth));
    lines.push(this.separator(safeWidth, " Messages "));

    for (const line of messageLines) {
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
    const typeIcon = this.providerIcon(providerId);
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
    this.editor.setText("");
    this.conversation.push({ role: "user", content: input });
    this.messages.push({ role: "user", content: input });
    this.messages.push({ role: "assistant", content: "" });
    this.status = "Streaming...";
    this.tui.requestRender(true);

    const controller = new AbortController();
    this.activeRequest = controller;

    try {
      // Build request body — only pass thinking for models that support it
      const body: Record<string, unknown> = {
        model: this.model,
        messages: this.conversation,
        stream: true,
      };
      if (this.currentModelSupportsThinking()) {
        body.thinking = { type: this.thinkingEnabled() ? "enabled" : "disabled" };
      }
      const stream = await this.client.chat.completions.create(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body as any,
        {
          signal: controller.signal,
        },
      );

      let reply = "";
      let reasoning = "";
      let state: "thinking" | "answering" = "thinking";

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as DeltaWithReasoning | undefined;
        if (!delta) {
          continue;
        }

        const contentDelta = delta.content || "";
        const reasoningDelta = delta.reasoning_content || "";

        if (reasoningDelta) {
          reasoning += reasoningDelta;
          this.status = "Thinking...";
        }
        if (contentDelta) {
          if (state === "thinking") {
            state = "answering";
          }
          reply += contentDelta;
          this.status = "Streaming...";
        }

        if (contentDelta || reasoningDelta) {
          this.updateLastAssistantMessage(reply, reasoning);
          this.tui.requestRender();
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

  private updateLastAssistantMessage(content: string, reasoning?: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "assistant") {
      last.content = content;
      if (reasoning) {
        last.reasoning = reasoning;
      }
    }
  }

  private renderMessages(width: number, maxRows: number): string[] {
    const rendered: string[] = [];
    const reasonPrefix = `${DIM}${YELLOW}> ${RESET}${DIM}`;
    const showReasoning = this.thinkingEnabled() && this.currentModelSupportsThinking();

    for (const message of this.messages) {
      // Render reasoning first (dimmed yellow) — only when thinking is enabled
      if (showReasoning && message.role === "assistant" && message.reasoning) {
        const wrapped = wrapTextWithAnsi(
          `${reasonPrefix}${message.reasoning}`,
          Math.max(1, width - 2),
        );
        for (const line of wrapped) {
          rendered.push(` ${line}`);
        }
        // Empty separator line between reasoning and answer
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
