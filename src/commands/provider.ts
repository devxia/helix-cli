import {
  type Component,
  type Focusable,
  Input,
  type SelectItem,
  SelectList,
  type SelectListTheme,
} from "@earendil-works/pi-tui";
import { listProviders, setProvider } from "../config.js";
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
// ProviderCommandUI — 2-phase inline component
// ---------------------------------------------------------------------------

type Phase = "select" | "input";

/**
 * Inline UI component that replaces the editor while the user configures
 * a provider.  Phase 1 = select provider, phase 2 = enter API key.
 */
class ProviderCommandUI implements Component, Focusable {
  focused = false;

  private phase: Phase = "select";
  private selectedId = "";
  private selectedLabel = "";

  private readonly selectList: SelectList;
  private readonly input: Input;
  private readonly ctx: CommandContext;

  constructor(ctx: CommandContext) {
    this.ctx = ctx;

    const providers = listProviders();
    const items: SelectItem[] = providers.map((p) => ({
      value: p.id,
      label: p.name,
      description: p.base_url,
    }));

    this.selectList = new SelectList(items, 10, selectTheme);

    this.selectList.onSelect = (item) => {
      this.selectedId = item.value;
      this.selectedLabel = item.label;
      this.phase = "input";
      this.input.setValue("");
      this.ctx.showComponent(this);
    };

    this.selectList.onCancel = () => {
      this.ctx.done();
    };

    this.input = new Input();

    this.input.onSubmit = (key) => {
      const trimmed = key.trim();
      if (!trimmed) return;

      setProvider(this.selectedId, trimmed);
      this.ctx.addSystemMessage(
        `${GREEN}Provider set to ${this.selectedLabel}.${RESET}`,
      );
      this.ctx.applyProvider();
      this.ctx.done();
    };

    this.input.onEscape = () => {
      this.phase = "select";
      this.ctx.showComponent(this);
    };
  }

  // -- Component ----------------------------------------------------------

  render(width: number): string[] {
    if (this.phase === "select") {
      const lines = this.selectList.render(width);
      lines.unshift(` ${GREEN}Select a provider:${RESET}`);
      lines.unshift("");
      lines.push("");
      lines.push(` ${DIM}↑↓ navigate  ↵ select  Esc cancel${RESET}`);
      return lines;
    }
    const lines = this.input.render(width);
    lines.unshift(` ${GREEN}Enter API key for ${this.selectedLabel}:${RESET}`);
    lines.unshift("");
    lines.push("");
    lines.push(` ${DIM}↵ confirm  Esc back${RESET}`);
    return lines;
  }

  handleInput(data: string): void {
    if (this.phase === "select") {
      this.selectList.handleInput(data);
    } else {
      this.input.handleInput(data);
    }
  }

  invalidate(): void {
    this.selectList.invalidate();
    this.input.invalidate();
  }
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export function executeProviderCommand(ctx: CommandContext): void {
  const ui = new ProviderCommandUI(ctx);
  ctx.showComponent(ui);
}
