import {
  type Component,
  type Focusable,
  Input,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  type SelectListLayoutOptions,
  matchesKey,
  Key,
  fuzzyFilter,
} from "@earendil-works/pi-tui";
import {
  type ProviderType,
  type ProviderConfig,
  type ModelDef,
  addCustomProvider,
  listProviders,
  removeProvider,
  setProvider,
  setProviderModels,
  getActiveModel,
  setActiveModel,
  isThinkingEnabled,
  setThinkingEnabled,
  loadConfig,
  hasApiKey,
  resolveApiKey,
} from "../config.js";
import {
  type CatalogEntry,
  fetchCatalog,
  inferProviderType,
  catalogBaseUrl,
  catalogModels,
} from "../catalog.js";
import { providerIcon } from "../utils/icons.js";
import { RESET, BOLD, DIM, CYAN, GREEN, YELLOW, RED, BLUE, MAGENTA } from "../utils/ansi.js";
import type { CommandContext } from "./index.js";

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
// Phase types
// ---------------------------------------------------------------------------

type Phase =
  | "loading"
  | "manager"
  | "add-source"
  | "catalog-list"
  | "api-key"
  | "model-pick"
  | "custom-name"
  | "custom-type"
  | "custom-url"
  | "custom-key";

// ---------------------------------------------------------------------------
// ProviderCommandUI — multi-phase inline component
// ---------------------------------------------------------------------------

class ProviderCommandUI implements Component, Focusable {
  focused = false;

  private phase: Phase = "loading";
  private catalog: Map<string, CatalogEntry> = new Map();
  private catalogItems: SelectItem[] = [];
  private filteredCatalogItems: SelectItem[] = [];
  private catalogSearch = "";
  private abortController: AbortController | null = null;

  // Selected provider state
  private selectedProviderId = "";
  private selectedProviderName = "";
  private selectedBaseUrl = "";
  private selectedType: ProviderType = "openai";
  private selectedModels: ModelDef[] = [];

  // Custom provider state
  private customName = "";
  private customType: ProviderType = "openai";
  private customBaseUrl = "";

  // Delete confirmation
  private deleteTarget: string | null = null;

  // Track the phase we came from before api-key input
  private apiKeyReturnPhase: Phase = "catalog-list";

  // UI components
  private managerList!: SelectList;
  private addSourceList!: SelectList;
  private catalogList!: SelectList;
  private apiKeyInput!: Input;
  private modelList!: SelectList;
  private customNameInput!: Input;
  private customTypeList!: SelectList;
  private customUrlInput!: Input;
  private customKeyInput!: Input;

  private readonly ctx: CommandContext;

  constructor(ctx: CommandContext) {
    this.ctx = ctx;
    this.initComponents();
    this.startCatalogFetch();
  }

  private initComponents(): void {
    // Manager list — populated later
    this.managerList = new SelectList([], 10, selectTheme, selectLayout);
    this.managerList.onSelect = (item) => this.handleManagerSelect(item);
    this.managerList.onCancel = () => this.ctx.done();

    // Add source picker
    this.addSourceList = new SelectList(
      [
        { value: "catalog", label: "📋 Known Provider", description: "Browse 100+ providers from models.dev" },
        { value: "custom", label: "🔧 Custom Provider", description: "Enter your own base URL and API key" },
      ],
      4,
      selectTheme,
    );
    this.addSourceList.onSelect = (item) => {
      if (item.value === "catalog") {
        this.phase = "catalog-list";
        this.catalogSearch = "";
        this.rebuildCatalogList();
      } else {
        this.phase = "custom-name";
        this.customNameInput.setValue("");
      }
      this.ctx.showComponent(this);
    };
    this.addSourceList.onCancel = () => {
      this.phase = "manager";
      this.ctx.showComponent(this);
    };

    // Catalog list — populated later
    this.catalogList = new SelectList([], 12, selectTheme, selectLayout);
    this.catalogList.onSelect = (item) => this.handleCatalogSelect(item);
    this.catalogList.onCancel = () => {
      this.phase = "add-source";
      this.ctx.showComponent(this);
    };

    // API key input
    this.apiKeyInput = new Input();
    this.apiKeyInput.onSubmit = (key) => {
      const trimmed = key.trim();
      if (!trimmed) return;
      this.applyProvider(trimmed);
    };
    this.apiKeyInput.onEscape = () => {
      this.phase = this.apiKeyReturnPhase;
      this.ctx.showComponent(this);
    };

    // Model picker — populated later
    this.modelList = new SelectList([], 12, selectTheme, selectLayout);
    this.modelList.onSelect = (item) => {
      setActiveModel(item.value);
      this.ctx.addSystemMessage(
        `${GREEN}Model set to ${item.label}.${RESET}`,
      );
      this.ctx.applyProvider();
      this.ctx.done();
    };
    this.modelList.onCancel = () => {
      this.ctx.applyProvider();
      this.ctx.done();
    };

    // Custom name input
    this.customNameInput = new Input();
    this.customNameInput.onSubmit = (value) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      this.customName = trimmed;
      this.phase = "custom-type";
      this.ctx.showComponent(this);
    };
    this.customNameInput.onEscape = () => {
      this.phase = "add-source";
      this.ctx.showComponent(this);
    };

    // Custom type selector
    this.customTypeList = new SelectList(
      [
        { value: "openai", label: "⚡ OpenAI-compatible", description: "Most providers (DeepSeek, Qwen, etc.)" },
        { value: "anthropic", label: "◈ Anthropic (Claude)", description: "Claude Messages API" },
        { value: "google-genai", label: "🔷 Google GenAI (Gemini)", description: "Gemini API" },
      ],
      5,
      selectTheme,
    );
    this.customTypeList.onSelect = (item) => {
      this.customType = item.value as ProviderType;
      this.phase = "custom-url";
      this.customUrlInput.setValue("");
      this.ctx.showComponent(this);
    };
    this.customTypeList.onCancel = () => {
      this.phase = "custom-name";
      this.ctx.showComponent(this);
    };

    // Custom URL input
    this.customUrlInput = new Input();
    this.customUrlInput.onSubmit = (value) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      this.customBaseUrl = trimmed;
      this.phase = "custom-key";
      this.customKeyInput.setValue("");
      this.ctx.showComponent(this);
    };
    this.customUrlInput.onEscape = () => {
      this.phase = "custom-type";
      this.ctx.showComponent(this);
    };

    // Custom key input
    this.customKeyInput = new Input();
    this.customKeyInput.onSubmit = (key) => {
      const trimmed = key.trim();
      if (!trimmed) return;
      let safeId = this.customName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!safeId) {
        safeId = `custom-${Date.now()}`;
      }
      addCustomProvider(safeId, this.customName, this.customType, this.customBaseUrl, trimmed);
      this.ctx.addSystemMessage(
        `${GREEN}Custom provider "${this.customName}" added and activated.${RESET}`,
      );
      this.ctx.applyProvider();
      this.ctx.done();
    };
    this.customKeyInput.onEscape = () => {
      this.phase = "custom-url";
      this.ctx.showComponent(this);
    };
  }

  // -- Catalog fetch -------------------------------------------------------

  private async startCatalogFetch(): Promise<void> {
    this.abortController = new AbortController();
    try {
      this.catalog = await fetchCatalog(this.abortController.signal);
      this.buildCatalogItems();
      if (this.phase === "loading") {
        this.phase = "manager";
        this.rebuildManagerList();
        this.ctx.showComponent(this);
      }
    } catch {
      if (this.phase === "loading") {
        this.phase = "manager";
        this.rebuildManagerList();
        this.ctx.showComponent(this);
      }
    }
  }

  private buildCatalogItems(): void {
    this.catalogItems = [];
    for (const [id, entry] of this.catalog) {
      const type = inferProviderType(entry);
      if (!type) continue;
      const modelCount = Object.keys(entry.models).length;
      this.catalogItems.push({
        value: id,
        label: `${providerIcon(id)} ${entry.name || id}`,
        description: `${modelCount} models`,
      });
    }
    // Sort: providers with more models first
    this.catalogItems.sort((a, b) => {
      const countA = parseInt(a.description ?? "0");
      const countB = parseInt(b.description ?? "0");
      return countB - countA;
    });
    this.filteredCatalogItems = this.catalogItems;
  }

  private rebuildCatalogList(): void {
    const query = this.catalogSearch.toLowerCase();
    if (query) {
      this.filteredCatalogItems = fuzzyFilter(
        this.catalogItems,
        query,
        (item) => `${item.label} ${item.description ?? ""}`,
      );
    } else {
      this.filteredCatalogItems = this.catalogItems;
    }
    this.catalogList = new SelectList(this.filteredCatalogItems, 12, selectTheme, selectLayout);
    this.catalogList.onSelect = (item) => this.handleCatalogSelect(item);
    this.catalogList.onCancel = () => {
      this.phase = "add-source";
      this.ctx.showComponent(this);
    };
  }

  // -- Manager list ---------------------------------------------------------

  private rebuildManagerList(): void {
    const providers = listProviders();
    const config = loadConfig();
    const items: SelectItem[] = providers.map((p) => {
      const isActive = p.id === config.active_provider;
      const hasKey = !!resolveApiKey(p.id, p).length;
      const icon = providerIcon(p.id);
      const keyHint = hasKey ? `${GREEN}key ✓${RESET}` : `${YELLOW}no key${RESET}`;
      const activeMark = isActive && hasKey ? `${GREEN}active${RESET}` : "";
      const parts = [keyHint];
      if (activeMark) parts.push(activeMark);
      return {
        value: p.id,
        label: `${icon} ${p.name}`,
        description: parts.join(" · "),
      };
    });
    items.push({
      value: "__add__",
      label: `${CYAN}＋ Add Provider${RESET}`,
      description: "Browse catalog or add custom endpoint",
    });
    this.managerList = new SelectList(items, 10, selectTheme, selectLayout);
    this.managerList.onSelect = (item) => this.handleManagerSelect(item);
    this.managerList.onCancel = () => this.ctx.done();
  }

  private handleManagerSelect(item: SelectItem): void {
    if (item.value === "__add__") {
      this.phase = "add-source";
      this.ctx.showComponent(this);
      return;
    }
    // Select existing provider — go to API key input
    this.selectedProviderId = item.value;
    this.selectedProviderName = item.label;
    const provider = (loadConfig().providers as Record<string, ProviderConfig>)[item.value];
    if (provider) {
      this.selectedBaseUrl = provider.base_url;
      this.selectedType = provider.type;
    }
    this.phase = "api-key";
    this.apiKeyReturnPhase = "manager";
    this.apiKeyInput.setValue(provider?.api_key ?? "");
    this.ctx.showComponent(this);
  }

  // -- Catalog selection ----------------------------------------------------

  private handleCatalogSelect(item: SelectItem): void {
    const entry = this.catalog.get(item.value);
    if (!entry) return;

    const type = inferProviderType(entry);
    if (!type) return;

    this.selectedProviderId = item.value;
    this.selectedProviderName = entry.name || item.value;
    this.selectedBaseUrl = catalogBaseUrl(entry, type);
    this.selectedType = type;
    this.selectedModels = catalogModels(entry);

    this.phase = "api-key";
    this.apiKeyReturnPhase = "catalog-list";
    this.apiKeyInput.setValue("");
    this.ctx.showComponent(this);
  }

  // -- Apply provider -------------------------------------------------------

  private applyProvider(apiKey: string): void {
    const existing = loadConfig().providers[this.selectedProviderId];
    if (existing) {
      setProvider(this.selectedProviderId, apiKey);
      // setProvider only touches config; persist models separately.
      if (this.selectedModels.length > 0) {
        setProviderModels(this.selectedProviderId, this.selectedModels);
      }
    } else {
      // addCustomProvider already persists models when provided.
      addCustomProvider(
        this.selectedProviderId,
        this.selectedProviderName,
        this.selectedType,
        this.selectedBaseUrl,
        apiKey,
        this.selectedModels.length > 0 ? this.selectedModels : undefined,
      );
    }

    this.ctx.addSystemMessage(
      `${GREEN}Provider set to ${providerIcon(this.selectedProviderId)} ${this.selectedProviderName}.${RESET}`,
    );

    if (this.selectedModels.length > 0) {
      this.phase = "model-pick";
      const modelItems: SelectItem[] = this.selectedModels.map((m) => ({
        value: m.id,
        label: m.label,
        description: m.description ?? "",
      }));
      this.modelList = new SelectList(modelItems, 12, selectTheme, selectLayout);
      this.modelList.onSelect = (mi) => {
        setActiveModel(mi.value);
        this.ctx.addSystemMessage(`${GREEN}Model set to ${mi.label}.${RESET}`);
        this.ctx.applyProvider();
        this.ctx.done();
      };
      this.modelList.onCancel = () => {
        this.ctx.applyProvider();
        this.ctx.done();
      };
      this.ctx.showComponent(this);
    } else {
      this.ctx.applyProvider();
      this.ctx.done();
    }
  }

  // -- Component ------------------------------------------------------------

  render(width: number): string[] {
    switch (this.phase) {
      case "loading":
        return this.renderLoading();
      case "manager":
        return this.renderManager(width);
      case "add-source":
        return this.renderAddSource(width);
      case "catalog-list":
        return this.renderCatalogList(width);
      case "api-key":
        return this.renderApiKey(width);
      case "model-pick":
        return this.renderModelPick(width);
      case "custom-name":
        return this.renderCustomName(width);
      case "custom-type":
        return this.renderCustomType(width);
      case "custom-url":
        return this.renderCustomUrl(width);
      case "custom-key":
        return this.renderCustomKey(width);
    }
  }

  // ── Phase renderers ────────────────────────────────────────────

  private renderLoading(): string[] {
    return [
      "",
      ` ${CYAN}⏳${RESET} ${BOLD}Loading provider catalog...${RESET}`,
      ` ${DIM}Fetching from models.dev${RESET}`,
      "",
    ];
  }

  private renderManager(width: number): string[] {
    const lines = this.managerList.render(width);
    const deleteHint = this.deleteTarget
      ? ` ${RED}✕ Delete "${this.deleteTarget}"? [y/N]${RESET}`
      : ` ${DIM}↑↓ navigate · ↵ select · d delete · Esc close${RESET}`;
    return [
      "",
      ` ${BOLD}⚙ Providers${RESET}`,
      deleteHint,
      ...lines,
      "",
    ];
  }

  private renderAddSource(width: number): string[] {
    const lines = this.addSourceList.render(width);
    return [
      "",
      ` ${BOLD}＋ Add Provider${RESET}`,
      ` ${DIM}Choose how to add a new provider${RESET}`,
      ...lines,
      "",
      ` ${DIM}↑↓ navigate · ↵ select · Esc back${RESET}`,
    ];
  }

  private renderCatalogList(width: number): string[] {
    const searchLine = this.catalogSearch
      ? ` ${CYAN}🔍 ${this.catalogSearch}█${RESET}`
      : ` ${DIM}🔍 Type to search...${RESET}`;
    const lines = this.catalogList.render(width);
    const count = this.filteredCatalogItems.length;
    return [
      "",
      ` ${BOLD}📋 Provider Catalog${RESET}  ${DIM}(${count} available)${RESET}`,
      searchLine,
      ...lines,
      "",
      ` ${DIM}↑↓ navigate · ↵ select · type to filter · Esc back${RESET}`,
    ];
  }

  private renderApiKey(width: number): string[] {
    const lines = this.apiKeyInput.render(width);
    const icon = providerIcon(this.selectedProviderId);
    return [
      "",
      ` ${icon} ${BOLD}${this.selectedProviderName}${RESET}`,
      ` ${DIM}Enter your API key${RESET}`,
      ...lines,
      "",
      ` ${DIM}↵ confirm · Esc back${RESET}`,
    ];
  }

  private renderModelPick(width: number): string[] {
    const lines = this.modelList.render(width);
    return [
      "",
      ` ${BOLD}🎯 Select Default Model${RESET}`,
      ` ${DIM}${this.selectedProviderName} · ${this.selectedModels.length} models${RESET}`,
      ...lines,
      "",
      ` ${DIM}↑↓ navigate · ↵ select · Esc skip${RESET}`,
    ];
  }

  private renderCustomName(width: number): string[] {
    const lines = this.customNameInput.render(width);
    return [
      "",
      ` ${BOLD}🔧 Custom Provider${RESET}  ${DIM}Step 1/4${RESET}`,
      ` ${DIM}Enter a display name${RESET}`,
      ...lines,
      "",
      ` ${DIM}↵ confirm · Esc back${RESET}`,
    ];
  }

  private renderCustomType(width: number): string[] {
    const lines = this.customTypeList.render(width);
    return [
      "",
      ` ${BOLD}🔧 Custom: "${this.customName}"${RESET}  ${DIM}Step 2/4${RESET}`,
      ` ${DIM}Select API protocol${RESET}`,
      ...lines,
      "",
      ` ${DIM}↑↓ navigate · ↵ select · Esc back${RESET}`,
    ];
  }

  private renderCustomUrl(width: number): string[] {
    const lines = this.customUrlInput.render(width);
    return [
      "",
      ` ${BOLD}🔧 Custom: "${this.customName}"${RESET}  ${DIM}Step 3/4${RESET}`,
      ` ${DIM}Enter base URL (${this.customType})${RESET}`,
      ...lines,
      "",
      ` ${DIM}↵ confirm · Esc back${RESET}`,
    ];
  }

  private renderCustomKey(width: number): string[] {
    const lines = this.customKeyInput.render(width);
    return [
      "",
      ` ${BOLD}🔧 Custom: "${this.customName}"${RESET}  ${DIM}Step 4/4${RESET}`,
      ` ${DIM}Enter API key${RESET}`,
      ...lines,
      "",
      ` ${DIM}↵ confirm · Esc back${RESET}`,
    ];
  }

  // -- Input handling -------------------------------------------------------

  handleInput(data: string): void {
    // Global: delete confirmation in manager
    if (this.deleteTarget !== null) {
      if (data === "y" || data === "Y") {
        removeProvider(this.deleteTarget);
        this.ctx.addSystemMessage(`${YELLOW}Provider "${this.deleteTarget}" removed.${RESET}`);
        this.deleteTarget = null;
        this.rebuildManagerList();
        this.ctx.showComponent(this);
      } else {
        this.deleteTarget = null;
        this.ctx.showComponent(this);
      }
      return;
    }

    // Phase-specific input
    switch (this.phase) {
      case "loading":
        break;
      case "manager":
        if (data === "d" || data === "D") {
          const selected = this.managerList.getSelectedItem();
          if (selected && selected.value !== "__add__") {
            this.deleteTarget = selected.value;
            this.ctx.showComponent(this);
          }
          return;
        }
        this.managerList.handleInput(data);
        break;
      case "add-source":
        this.addSourceList.handleInput(data);
        break;
      case "catalog-list":
        if (matchesKey(data, Key.escape)) {
          if (this.catalogSearch) {
            this.catalogSearch = "";
            this.rebuildCatalogList();
            this.ctx.showComponent(this);
          } else {
            this.phase = "add-source";
            this.ctx.showComponent(this);
          }
          return;
        }
        if (matchesKey(data, Key.backspace)) {
          if (this.catalogSearch.length > 0) {
            this.catalogSearch = this.catalogSearch.slice(0, -1);
            this.rebuildCatalogList();
            this.ctx.showComponent(this);
          }
          return;
        }
        if (matchesKey(data, Key.enter)) {
          this.catalogList.handleInput(data);
          return;
        }
        if (data.length === 1 && data >= " ") {
          this.catalogSearch += data;
          this.rebuildCatalogList();
          this.ctx.showComponent(this);
          return;
        }
        this.catalogList.handleInput(data);
        break;
      case "api-key":
        this.apiKeyInput.handleInput(data);
        break;
      case "model-pick":
        this.modelList.handleInput(data);
        break;
      case "custom-name":
        this.customNameInput.handleInput(data);
        break;
      case "custom-type":
        this.customTypeList.handleInput(data);
        break;
      case "custom-url":
        this.customUrlInput.handleInput(data);
        break;
      case "custom-key":
        this.customKeyInput.handleInput(data);
        break;
    }
  }

  invalidate(): void {
    this.managerList.invalidate();
    this.addSourceList.invalidate();
    this.catalogList.invalidate();
    this.apiKeyInput.invalidate();
    this.modelList.invalidate();
    this.customNameInput.invalidate();
    this.customTypeList.invalidate();
    this.customUrlInput.invalidate();
    this.customKeyInput.invalidate();
  }
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

export function executeProviderCommand(ctx: CommandContext): void {
  const ui = new ProviderCommandUI(ctx);
  ctx.showComponent(ui);
}
