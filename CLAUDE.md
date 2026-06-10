# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Helix CLI is a terminal-native AI chat client. It uses pi-TUI for the terminal UI and the OpenAI SDK (with custom `base_url`) to talk to LLM providers. The app compiles to a single binary via `bun build --compile`.

See `AGENTS.md` for product philosophy, technical constraints (runtime, libraries, distribution), and development principles. **The project map in AGENTS.md is aspirational** — only what exists in `src/` is implemented.

## Commands

```bash
# Development (hot reload)
bun --hot src/main.ts

# Build single binary (~70MB)
bun build --compile --outfile helix src/main.ts

# Run the built binary
./helix
```

There is no test suite, linter, or type-checker configured yet.

## Architecture

```
src/
  main.ts                  — Entry point: parse --version, instantiate HelixApp
  config.ts                — Zod schemas, ~/.helix/config.toml persistence,
                             model list cache (~/.helix/models_cache.toml),
                             API-driven model refresh from /v1/models
  commands/
    index.ts               — CommandRegistry singleton + CommandContext + SlashCommandDef
    provider.ts            — /provider slash command (2-phase: select → API key input)
    model.ts               — /model slash command (model picker + thinking toggle)
  tui/
    app.ts                 — HelixApp: creates TUI, ChatScreen, wires Ctrl+C (press→interrupt, double→exit)
    screens/
      chat.ts              — ChatScreen: the main UI — Editor input, OpenAI streaming,
                             conversation history, reasoning_content rendering,
                             slash-command routing, autocomplete wiring
```

### Key patterns

**pi-TUI component model.** Components implement `Component` + `Focusable`. No JSX, no virtual DOM. Create with `new`, add via `addChild()`, manage focus with `setFocus()`. Input is handled imperatively via `handleInput(data)`.

**Slash commands.** Commands register via `registry.register({name, description, execute})`. The `execute` callback receives a `CommandContext` that lets commands show inline UI components (replacing the editor), add system messages, or trigger client/provider refresh. Slash command autocomplete is wired through pi-TUI's `CombinedAutocompleteProvider`.

**Config flow.** `loadConfig()` reads `~/.helix/config.toml` → Zod parse → typed Config. `saveConfig()` validates then writes TOML. Provider/model changes persist immediately. Environment variables (`KIMI_API_KEY`, `KIMI_BASE_URL`, `KIMI_MODEL`) override config values at runtime.

**Streaming chat.** The ChatScreen creates an `OpenAI` client, sends `conversation` array via `chat.completions.create({stream: true})`, and processes chunks with reasoning_content support (Kimi-specific `DeltaWithReasoning`). Abort is handled via `AbortController` — the first Ctrl+C aborts the stream, the second exits.

**ANSI rendering.** pi-TUI expects raw ANSI escape codes embedded in strings. Color constants (`DIM`, `CYAN`, `GREEN`, `RED`, `YELLOW`) are defined in each file that renders. Helper functions: `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`.

## Code conventions

- **Commits:** `<type>(<scope>): <subject>` — types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- **Co-author:** commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **No agent identity in commits/PRs/comments**
- **TOML for config**, not JSON
- **bun:sqlite** is listed as a data layer in AGENTS.md but not yet used; `Bun.TOML` is used for config
