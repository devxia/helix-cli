import type { Component } from "@earendil-works/pi-tui";

/**
 * Context passed to slash command handlers.
 * Commands use this to interact with the TUI and chat screen.
 */
export interface CommandContext {
  /** Show a component in place of the editor, stealing input focus. */
  showComponent(component: Component): void;
  /** Restore the editor focus. Call when the command is done. */
  done(): void;
  /** Add a system message to the chat log. */
  addSystemMessage(text: string): void;
  /** Re-create the OpenAI client (e.g. after provider change). */
  applyProvider(): void;
}

export interface SlashCommandDef {
  name: string;
  description: string;
  execute(ctx: CommandContext): void;
}

class CommandRegistry {
  private readonly commands = new Map<string, SlashCommandDef>();

  register(cmd: SlashCommandDef): void {
    this.commands.set(cmd.name, cmd);
  }

  parse(input: string): SlashCommandDef | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;
    const name = trimmed.slice(1).split(/\s+/)[0]!;
    return this.commands.get(name) ?? null;
  }

  list(): SlashCommandDef[] {
    return [...this.commands.values()];
  }
}

/** Singleton command registry. */
export const registry = new CommandRegistry();
