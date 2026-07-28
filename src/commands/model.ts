import {
  type Component,
  type Focusable,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  matchesKey,
  Key,
  fuzzyFilter,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import {
  type ModelDef,
  type ProviderConfig,
  type ReasoningCapability,
  type ThinkingPreference,
  cycleThinkingState,
  getAvailableModels,
  hasCredentials,
  loadConfig,
  refreshProviderModels,
  resolveThinkingPreference,
  setActiveSelection,
  setThinkingPreference,
  thinkingStates,
} from "../config.js";
import { providerIcon } from "../utils/icons.js";
import { RESET, BOLD, DIM, CYAN, GREEN } from "../utils/ansi.js";
import type { CommandContext } from "./index.js";

const theme: SelectListTheme = {
  selectedPrefix: (text) => `${CYAN}${text}${RESET}`,
  selectedText: (text) => `${CYAN}${text}${RESET}`,
  description: (text) => `${DIM}${text}${RESET}`,
  scrollInfo: (text) => `${DIM}${text}${RESET}`,
  noMatch: (text) => `${DIM}${text}${RESET}`,
};

export interface ModelChoice {
  key: string;
  providerId: string;
  providerName: string;
  model: ModelDef;
}
export interface ModelTab {
  id: string;
  label: string;
  choices: readonly ModelChoice[];
}

export function buildModelChoices(providers: Record<string, ProviderConfig>): ModelChoice[] {
  const choices: ModelChoice[] = [];
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!hasCredentials(provider)) continue;
    for (const model of getAvailableModels(providerId)) {
      choices.push({
        key: `${providerId}\u0000${model.id}`,
        providerId,
        providerName: provider.name,
        model: { ...model, reasoning: { ...model.reasoning, effort: model.reasoning.effort ? [...model.reasoning.effort] : undefined } },
      });
    }
  }
  return choices;
}

export function buildModelTabs(choices: readonly ModelChoice[]): ModelTab[] {
  const grouped = new Map<string, ModelChoice[]>();
  for (const choice of choices) {
    const group = grouped.get(choice.providerId) ?? [];
    group.push(choice);
    grouped.set(choice.providerId, group);
  }
  const tabs: ModelTab[] = [];
  if (grouped.size > 1) tabs.push({ id: "__all__", label: "All", choices: [...choices] });
  for (const [providerId, models] of grouped) {
    tabs.push({ id: providerId, label: models[0]?.providerName ?? providerId, choices: models });
  }
  return tabs;
}

export function thinkingPreview(capability: ReasoningCapability, current: ThinkingPreference): string {
  return thinkingStates(capability).map((state) => {
    const active = state.enabled === current.enabled && state.effort === current.effort;
    return `${active ? "◉" : "○"} ${state.label}`;
  }).join(" │ ");
}

class ModelSelector implements Component, Focusable {
  focused = false;
  private readonly choices: readonly ModelChoice[];
  private readonly tabs: readonly ModelTab[];
  private activeTabIndex = 0;
  private search = "";
  private list: SelectList;
  private readonly drafts = new Map<string, ThinkingPreference>();
  private readonly modified = new Set<string>();

  constructor(private readonly ctx: CommandContext) {
    const snapshot = loadConfig();
    this.choices = buildModelChoices({ ...snapshot.providers });
    this.tabs = buildModelTabs(this.choices);
    const activeProviderTab = this.tabs.findIndex((tab) => tab.id === snapshot.active_provider);
    if (activeProviderTab >= 0) this.activeTabIndex = activeProviderTab;
    for (const choice of this.choices) {
      this.drafts.set(choice.key, resolveThinkingPreference(choice.providerId, choice.model));
    }
    this.list = this.buildList();
    // The selector snapshot never mutates. SWR results appear next invocation.
    for (const providerId of new Set(this.choices.map((choice) => choice.providerId))) void refreshProviderModels(providerId);
  }

  private tabChoices(): readonly ModelChoice[] { return this.tabs[this.activeTabIndex]?.choices ?? []; }
  private filtered(): ModelChoice[] {
    const choices = [...this.tabChoices()];
    return this.search ? fuzzyFilter(choices, this.search.toLowerCase(), (choice) => `${choice.model.label} ${choice.model.id} ${choice.providerName}`) : choices;
  }

  private buildList(): SelectList {
    const config = loadConfig();
    const items: SelectItem[] = this.filtered().map((choice) => ({
      value: choice.key,
      label: choice.model.label,
      description: `${choice.providerName} · ${choice.model.id}${config.active_provider === choice.providerId && config.active_model === choice.model.id ? `  ${GREEN}✓${RESET}` : ""}`,
    }));
    if (!items.length) items.push({ value: "__none__", label: this.search ? "No matches" : "No configured models", description: "Use /provider first" });
    const list = new SelectList(items, 12, theme, { maxPrimaryColumnWidth: 24 });
    list.onSelect = (item) => this.confirm(item.value);
    list.onCancel = () => this.ctx.done();
    return list;
  }

  private rebuild(): void {
    this.list.onSelect = undefined;
    this.list.onCancel = undefined;
    this.list = this.buildList();
  }

  private selectedChoice(): ModelChoice | undefined {
    const key = this.list.getSelectedItem()?.value;
    return this.choices.find((choice) => choice.key === key);
  }
  private preference(choice: ModelChoice): ThinkingPreference {
    return this.drafts.get(choice.key) ?? { enabled: choice.model.reasoning.availability !== "none" };
  }

  private confirm(key: string): void {
    if (key === "__none__") return;
    const choice = this.choices.find((item) => item.key === key);
    if (!choice) return;
    setActiveSelection(choice.providerId, choice.model.id);
    if (this.modified.has(choice.key)) setThinkingPreference(choice.providerId, choice.model, this.preference(choice));
    const preference = this.preference(choice);
    const thinking = choice.model.reasoning.availability === "none" ? "" : ` (Thinking ${preference.enabled ? preference.effort ?? "AUTO" : "OFF"})`;
    this.ctx.addNotice(`${GREEN}Model set to ${choice.model.label} on ${choice.providerName}${thinking}.${RESET}`);
    this.ctx.applyProvider();
    this.ctx.done();
  }

  render(width: number): string[] {
    const lines = [`${BOLD}Model${RESET}  ${DIM}frozen provider/model snapshot${RESET}`];
    if (this.tabs.length > 1) {
      const tabLine = this.tabs.map((tab, index) => index === this.activeTabIndex
        ? `${CYAN}▐${RESET} ${providerIcon(tab.id)} ${tab.label} (${tab.choices.length}) ${CYAN}▌${RESET}`
        : `${DIM}${providerIcon(tab.id)} ${tab.label} (${tab.choices.length})${RESET}`).join("  ");
      lines.push(truncateToWidth(` ${tabLine}`, Math.max(1, width), "…", true));
    }
    lines.push(this.search ? ` ${CYAN}🔍 ${this.search}█${RESET}` : ` ${DIM}🔍 Type to search...${RESET}`);
    lines.push(...this.list.render(width));
    const choice = this.selectedChoice();
    if (choice) {
      const preview = thinkingPreview(choice.model.reasoning, this.preference(choice));
      if (preview) lines.push(truncateToWidth(` Thinking  ${preview}`, Math.max(1, width), "…", true));
    }
    lines.push(` ${DIM}↑↓ pick  ←→ Thinking  ${this.tabs.length > 1 ? "Tab provider  " : ""}↵ confirm  Esc cancel${RESET}`);
    return lines;
  }

  handleInput(data: string): void {
    if (this.tabs.length > 1 && (matchesKey(data, Key.tab) || matchesKey(data, Key.shift(Key.tab)))) {
      const direction = matchesKey(data, Key.tab) ? 1 : -1;
      this.activeTabIndex = (this.activeTabIndex + direction + this.tabs.length) % this.tabs.length;
      this.search = "";
      this.rebuild();
      this.ctx.showComponent(this);
      return;
    }
    const choice = this.selectedChoice();
    if (choice && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
      const states = thinkingStates(choice.model.reasoning);
      const next = cycleThinkingState(states, this.preference(choice), matchesKey(data, Key.left) ? -1 : 1);
      if (next && states.length > 1) {
        this.drafts.set(choice.key, { enabled: next.enabled, effort: next.effort });
        this.modified.add(choice.key);
        this.ctx.showComponent(this);
      }
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.search) { this.search = ""; this.rebuild(); this.ctx.showComponent(this); }
      else this.ctx.done();
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      if (this.search) { this.search = this.search.slice(0, -1); this.rebuild(); this.ctx.showComponent(this); }
      return;
    }
    if (matchesKey(data, Key.enter)) { this.list.handleInput(data); return; }
    if (data.length === 1 && data >= " ") { this.search += data; this.rebuild(); this.ctx.showComponent(this); return; }
    this.list.handleInput(data);
    this.ctx.showComponent(this);
  }

  invalidate(): void { this.list.invalidate(); }
}

export function executeModelCommand(ctx: CommandContext): void { ctx.showComponent(new ModelSelector(ctx)); }
