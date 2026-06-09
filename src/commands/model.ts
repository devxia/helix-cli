import {
  type Component,
  type Focusable,
  type SelectItem,
  SelectList,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import {
  getActiveModel,
  getAvailableModels,
  isThinkingEnabled,
  loadConfig,
  setActiveModel,
  setThinkingEnabled,
} from "../config.js";
import type { CommandContext } from "./index.js";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";

const selectTheme: SelectListTheme = {
  selectedPrefix: (text) => `${CYAN}${text}${RESET}`,
  selectedText: (text) => `${CYAN}${text}${RESET}`,
  description: (text) => `${DIM}${text}${RESET}`,
  scrollInfo: (text) => `${DIM}${text}${RESET}`,
  noMatch: (text) => `${DIM}${text}${RESET}`,
};

// ---------------------------------------------------------------------------
// ModelCommandUI
// ---------------------------------------------------------------------------

const THINKING_VALUE = "__thinking__";

class ModelCommandUI implements Component, Focusable {
  focused = false;

  private selectList: SelectList;
  private readonly ctx: CommandContext;

  constructor(ctx: CommandContext) {
    this.ctx = ctx;
    this.selectList = this.createSelectList();
  }

  private createSelectList(): SelectList {
    const config = loadConfig();
    const providerId = config.active_provider;
    const modelDefs = getAvailableModels(providerId);
    const currentModel = getActiveModel();
    const thinking = isThinkingEnabled();

    const items: SelectItem[] = modelDefs.map((m) => ({
      value: m.id,
      label: m.label,
      description: m.id === currentModel
        ? `${m.description ? m.description + " · " : ""}✓ active`
        : m.description ?? "",
    }));

    // Thinking toggle item
    items.push({
      value: THINKING_VALUE,
      label: thinking ? "Thinking: ON" : "Thinking: OFF",
      description: thinking ? "Click to disable" : "Click to enable",
    });

    const list = new SelectList(items, 12, selectTheme);

    list.onSelect = (item) => {
      if (item.value === THINKING_VALUE) {
        const next = !thinking;
        setThinkingEnabled(next);
        // Recreate list with updated toggle label
        this.selectList = this.createSelectList();
        this.ctx.showComponent(this);
        return;
      }

      // Model selected
      setActiveModel(item.value);
      this.ctx.addSystemMessage(
        `${GREEN}Model set to ${item.label}.${RESET}`,
      );
      this.ctx.applyProvider();
      this.ctx.done();
    };

    list.onCancel = () => {
      this.ctx.done();
    };

    return list;
  }

  // -- Component ----------------------------------------------------------

  render(width: number): string[] {
    const config = loadConfig();
    const thinking = isThinkingEnabled();
    const lines = this.selectList.render(width);
    return [
      "",
      ` ${GREEN}Provider: ${config.active_provider} · Thinking: ${thinking ? "ON" : "OFF"}${RESET}`,
      ...lines,
      "",
      ` ${DIM}↑↓ navigate  ↵ select  Esc cancel${RESET}`,
    ];
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }

  invalidate(): void {
    this.selectList.invalidate();
  }
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export function executeModelCommand(ctx: CommandContext): void {
  const ui = new ModelCommandUI(ctx);
  ctx.showComponent(ui);
}
