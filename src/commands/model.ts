import {
  type Component,
  type Focusable,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  type SelectListLayoutOptions,
  matchesKey,
  Key,
  fuzzyFilter,
} from "@earendil-works/pi-tui";
import {
  type ProviderConfig,
  type ModelDef,
  getActiveModel,
  getAvailableModels,
  hasApiKey,
  isThinkingEnabled,
  loadConfig,
  setActiveModel,
  setThinkingEnabled,
} from "../config.js";
import { providerIcon } from "../utils/icons.js";
import type { CommandContext } from "./index.js";

// ---------------------------------------------------------------------------
// Theme & ANSI
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";

const selectTheme: SelectListTheme = {
  selectedPrefix: (text) => `${CYAN}${text}${RESET}`,
  selectedText: (text) => `${CYAN}${text}${RESET}`,
  description: (text) => `${DIM}${text}${RESET}`,
  scrollInfo: (text) => `${DIM}${text}${RESET}`,
  noMatch: (text) => `${DIM}${text}${RESET}`,
};

const selectLayout: SelectListLayoutOptions = {
  maxPrimaryColumnWidth: 24,
};

// ---------------------------------------------------------------------------
// Model choice with provider grouping
// ---------------------------------------------------------------------------

interface ModelChoice {
  id: string;
  label: string;
  providerId: string;
  providerName: string;
  description: string;
  displayLabel: string;
  reasoning?: boolean;
}

// ---------------------------------------------------------------------------
// TabbedModelSelector — model picker with visual tabs + search + thinking
// ---------------------------------------------------------------------------

class TabbedModelSelector implements Component, Focusable {
  focused = false;

  private readonly allChoices: ModelChoice[];
  private readonly tabs: { id: string; label: string; icon: string; choices: ModelChoice[] }[];
  private activeTabIndex = 0;
  private searchQuery = "";
  private thinkingDraft: boolean;
  private activeList: SelectList;
  /** Track last selected model so we auto-enable thinking on model change. */
  private lastSelectedModelId = "";

  private readonly ctx: CommandContext;

  constructor(ctx: CommandContext) {
    this.ctx = ctx;
    this.thinkingDraft = isThinkingEnabled();

    // Collect models ONLY from providers that have API keys
    this.allChoices = this.buildAllChoices();

    // Build tabs
    this.tabs = this.buildTabs(this.allChoices);

    // Set initial tab to active provider (if it has a key)
    const config = loadConfig();
    const activeProviderIdx = this.tabs.findIndex((t) => t.id === config.active_provider);
    if (activeProviderIdx >= 0) this.activeTabIndex = activeProviderIdx;

    this.activeList = this.buildListForTab(this.activeTabIndex, "");
  }

  private buildAllChoices(): ModelChoice[] {
    const config = loadConfig();
    const providers = config.providers;
    const choices: ModelChoice[] = [];

    for (const [pid, pconfig] of Object.entries(providers as Record<string, ProviderConfig>)) {
      // Skip providers without API keys
      if (!hasApiKey(pid, pconfig)) continue;

      const models = getAvailableModels(pid);
      for (const m of models) {
        choices.push({
          id: m.id,
          label: m.label,
          providerId: pid,
          providerName: pconfig.name,
          description: m.description ?? "",
          displayLabel: `${m.label} (${pconfig.name})`,
          reasoning: m.reasoning,
        });
      }
    }

    return choices;
  }

  private buildTabs(choices: ModelChoice[]): { id: string; label: string; icon: string; choices: ModelChoice[] }[] {
    const providerMap = new Map<string, ModelChoice[]>();
    for (const c of choices) {
      if (!providerMap.has(c.providerId)) providerMap.set(c.providerId, []);
      providerMap.get(c.providerId)!.push(c);
    }

    const tabs: { id: string; label: string; icon: string; choices: ModelChoice[] }[] = [];

    // Add "All" tab only if there are multiple providers with keys
    if (providerMap.size > 1) {
      tabs.push({ id: "__all__", label: "All", icon: "📋", choices });
    }

    for (const [pid, pchoices] of providerMap) {
      tabs.push({
        id: pid,
        label: pchoices[0]?.providerName ?? pid,
        icon: providerIcon(pid),
        choices: pchoices,
      });
    }

    return tabs;
  }

  private buildListForTab(tabIndex: number, search: string): SelectList {
    const tab = this.tabs[tabIndex];
    if (!tab) return new SelectList([], 10, selectTheme);

    let choices = tab.choices;

    if (search) {
      choices = fuzzyFilter(choices, search.toLowerCase(), (c) => c.displayLabel);
    }

    const currentModel = getActiveModel();
    const items: SelectItem[] = choices.map((c) => {
      const parts: string[] = [c.id];
      if (c.description) parts.push(c.description);
      const base = parts.join(" · ");
      return {
        value: c.id,
        label: c.label,
        description: c.id === currentModel
          ? `${base}  ${GREEN}✓${RESET}`
          : base,
      };
    });

    if (items.length === 0) {
      items.push({
        value: "__none__",
        label: search ? `No matches for "${search}"` : "No models available",
        description: search ? "" : "Use /provider to configure an API key first",
      });
    }

    const list = new SelectList(items, 12, selectTheme, selectLayout);
    list.onSelect = (item) => {
      if (item.value === "__none__") return;
      setActiveModel(item.value);
      const choice = tab.choices.find((c) => c.id === item.value);
      if (choice?.reasoning) {
        setThinkingEnabled(this.thinkingDraft);
        this.ctx.addSystemMessage(
          `${GREEN}Model set to ${item.label} (thinking ${this.thinkingDraft ? "ON" : "OFF"}).${RESET}`,
        );
      } else {
        this.ctx.addSystemMessage(
          `${GREEN}Model set to ${item.label}.${RESET}`,
        );
      }
      this.ctx.applyProvider();
      this.ctx.done();
    };
    list.onCancel = () => {
      this.ctx.done();
    };
    return list;
  }

  private rebuildList(): void {
    this.activeList = this.buildListForTab(this.activeTabIndex, this.searchQuery);
  }

  // -- Component ------------------------------------------------------------

  render(width: number): string[] {
    const lines: string[] = [];
    const config = loadConfig();
    const activeProvider = (config.providers as Record<string, ProviderConfig>)[config.active_provider];
    const currentModel = getActiveModel();

    // ── Header bar ──────────────────────────────────────────────
    const headerIcon = providerIcon(config.active_provider);
    const headerText = `${BOLD}Model${RESET}  ${DIM}${headerIcon} ${activeProvider?.name ?? config.active_provider} › ${currentModel}${RESET}`;
    lines.push(headerText);

    // ── Tab strip ───────────────────────────────────────────────
    if (this.tabs.length > 1) {
      lines.push(...this.renderTabs(width));
    }

    // ── Search ──────────────────────────────────────────────────
    if (this.searchQuery) {
      lines.push(` ${CYAN}🔍 ${this.searchQuery}█${RESET}`);
    } else {
      lines.push(` ${DIM}🔍 Type to search...${RESET}`);
    }

    // ── Column headers ──────────────────────────────────────────
    const barLen = Math.min(width - 3, 60);
    lines.push(` ${BLUE}  Model${" ".repeat(22)}Details${RESET}`);
    lines.push(` ${DIM}  ${"─".repeat(barLen)}${RESET}`);

    // ── Model list ──────────────────────────────────────────────
    const listLines = this.activeList.render(width);
    lines.push(...listLines);

    // ── Thinking toggle (only for reasoning-capable models) ─────
    const selectedItem = this.activeList.getSelectedItem();
    const selectedChoice = selectedItem
      ? this.tabs[this.activeTabIndex]?.choices.find((c) => c.id === selectedItem.value)
      : undefined;
    const modelSupportsThinking = selectedChoice?.reasoning === true;

    // Auto-enable thinking when landing on a reasoning-capable model
    if (modelSupportsThinking && selectedItem && selectedItem.value !== this.lastSelectedModelId) {
      this.thinkingDraft = true;
    }
    if (selectedItem) {
      this.lastSelectedModelId = selectedItem.value;
    }

    if (modelSupportsThinking) {
      lines.push(` ${DIM}  ${"─".repeat(barLen)}${RESET}`);

      const thinking = this.thinkingDraft;
      const onStyle = thinking ? `${GREEN}${BOLD}◉ ON${RESET}` : `${DIM}○ ON${RESET}`;
      const offStyle = thinking ? `${DIM}○ OFF${RESET}` : `${GREEN}${BOLD}◉ OFF${RESET}`;
      lines.push(` ${CYAN}Thinking${RESET}  ${DIM}←${RESET} ${onStyle}  │  ${offStyle} ${DIM}→${RESET}`);
    }

    // ── Footer ──────────────────────────────────────────────────
    const hints = ["↑↓ pick", "↵ confirm"];
    if (this.tabs.length > 1) hints.push("Tab provider");
    hints.push("Esc cancel");
    lines.push(` ${DIM}${hints.join("  ")}${RESET}`);

    return lines;
  }

  private renderTabs(width: number): string[] {
    if (this.tabs.length === 0) return [];

    const tabChars = this.tabs.map((t, i) => {
      const count = t.choices.length;
      const text = `${t.icon} ${t.label} (${count})`;
      const isActive = i === this.activeTabIndex;
      return { text, isActive, plainLen: text.length };
    });

    const availableWidth = width - 2;
    const fullWidth = tabChars.reduce((sum, t) => sum + t.plainLen + 3, -1); // +3 padding per tab, -1 last spacer

    if (fullWidth <= availableWidth) {
      // All tabs fit — render with visual pill shapes
      const parts: string[] = [];
      for (let i = 0; i < tabChars.length; i++) {
        const t = tabChars[i]!;
        if (t.isActive) {
          // Active tab: reversed background style
          parts.push(`${CYAN}▐${RESET} ${t.text} ${CYAN}▌${RESET}`);
        } else {
          // Inactive tab: dimmed
          parts.push(`${DIM} ${t.text} ${RESET}`);
        }
      }
      return [` ${parts.join(" ")}`];
    }

    // Tabs overflow — scrolling window
    const avgTabWidth = 14;
    const VISIBLE_COUNT = Math.max(1, Math.floor(availableWidth / avgTabWidth));
    let start = Math.max(0, this.activeTabIndex - Math.floor(VISIBLE_COUNT / 2));
    let end = Math.min(start + VISIBLE_COUNT, tabChars.length);
    if (end - start < VISIBLE_COUNT) start = Math.max(0, end - VISIBLE_COUNT);

    const parts: string[] = [];
    if (start > 0) parts.push(`${DIM}◀${RESET} `);
    for (let i = start; i < end; i++) {
      const t = tabChars[i]!;
      if (t.isActive) {
        parts.push(`${CYAN}▐${RESET} ${t.text} ${CYAN}▌${RESET}`);
      } else {
        parts.push(`${DIM} ${t.text} ${RESET}`);
      }
    }
    if (end < tabChars.length) parts.push(` ${DIM}▶${RESET}`);
    return [` ${parts.join(" ")}`];
  }

  handleInput(data: string): void {
    // Tab / Shift+Tab — cycle tabs
    if (matchesKey(data, Key.tab)) {
      this.activeTabIndex = (this.activeTabIndex + 1) % this.tabs.length;
      this.searchQuery = "";
      this.rebuildList();
      this.ctx.showComponent(this);
      return;
    }
    if (matchesKey(data, Key.shift(Key.tab))) {
      this.activeTabIndex = (this.activeTabIndex - 1 + this.tabs.length) % this.tabs.length;
      this.searchQuery = "";
      this.rebuildList();
      this.ctx.showComponent(this);
      return;
    }

    // Left → thinking ON, Right → thinking OFF
    if (matchesKey(data, Key.left)) {
      this.thinkingDraft = true;
      this.ctx.showComponent(this);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.thinkingDraft = false;
      this.ctx.showComponent(this);
      return;
    }

    // Escape
    if (matchesKey(data, Key.escape)) {
      if (this.searchQuery) {
        this.searchQuery = "";
        this.rebuildList();
        this.ctx.showComponent(this);
      } else {
        this.ctx.done();
      }
      return;
    }

    // Backspace
    if (matchesKey(data, Key.backspace)) {
      if (this.searchQuery.length > 0) {
        this.searchQuery = this.searchQuery.slice(0, -1);
        this.rebuildList();
        this.ctx.showComponent(this);
      }
      return;
    }

    // Enter
    if (matchesKey(data, Key.enter)) {
      this.activeList.handleInput(data);
      return;
    }

    // Printable character → search
    if (data.length === 1 && data >= " ") {
      this.searchQuery += data;
      this.rebuildList();
      this.ctx.showComponent(this);
      return;
    }

    // Arrow keys → list
    this.activeList.handleInput(data);
    this.ctx.showComponent(this);
  }

  invalidate(): void {
    this.activeList.invalidate();
  }
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export function executeModelCommand(ctx: CommandContext): void {
  const ui = new TabbedModelSelector(ctx);
  ctx.showComponent(ui);
}
