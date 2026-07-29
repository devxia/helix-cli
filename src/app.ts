import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  initTheme,
  InteractiveMode,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { launchSpecialistProcess } from "./delegate/process.js";
import { createDelegateTool } from "./delegate/tool.js";
import type { SpecialistLauncher } from "./delegate/types.js";
import type { HelixPaths } from "./paths.js";
import { SeqkitManager } from "./seqkit/manager.js";
import { HelixSettingsStorage } from "./settings-storage.js";
import { createSeqkitTools } from "./seqkit/tools.js";

export const HELIX_SYSTEM_PROMPT = `You are Helix, a scientific and bioinformatics agent running in the user's terminal.
Answer directly in the user's language and distinguish observations from interpretation.
Use only the tools actually provided. Never invent shell access, commands, files, tool results, or scientific evidence.
Use read-only discovery tools to locate relevant local files. Use Helix bioinformatics tools for data processing and inspection.
Delegate only when an independent Specialist Agent materially improves the result. Specialist outputs are advisory evidence: evaluate them and remain responsible for the final answer. Read-only Specialists may run automatically within fixed limits. A Development Worker requires the user's explicit authorization for each Delegation Run.
Before a potentially long scan, tell the user what will be read. After a tool run, explain the result and cite the recorded executable version and input path when relevant.
Do not claim that FASTA/FASTQ and BAM have the same semantics. SAM, CRAM, VCF, and unprovided operations are unsupported unless a future Agent Tool explicitly provides them.`;

export interface RunHelixAppOptions {
  readonly cwd: string;
  readonly paths: HelixPaths;
}

function existing(paths: string[]): string[] {
  return paths.filter(existsSync);
}

export async function runHelixApp(options: RunHelixAppOptions): Promise<void> {
  registerBunOAuthFlows();
  await mkdir(options.paths.agentDir, { recursive: true, mode: 0o700 });

  const modelRuntime = await ModelRuntime.create({
    authPath: join(options.paths.agentDir, "auth.json"),
    modelsPath: join(options.paths.agentDir, "models.json"),
    allowModelNetwork: false,
  });
  const seqkitManager = new SeqkitManager({ toolsDir: options.paths.toolsDir });
  const helixTools = createSeqkitTools(seqkitManager);
  const launchSpecialist: SpecialistLauncher = (request, launchOptions) => launchSpecialistProcess(
    request,
    launchOptions,
    { env: { ...process.env, HELIX_HOME: options.paths.agentDir } },
  );
  const delegateTool = createDelegateTool({ launch: launchSpecialist });
  const parentTools = [...helixTools, delegateTool];
  const toolNames = ["read", "grep", "find", "ls", ...parentTools.map((tool) => tool.name)];

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    const settingsManager = SettingsManager.fromStorage(
      new HelixSettingsStorage(cwd, agentDir),
      { projectTrusted: true },
    );

    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      modelRuntime,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: HELIX_SYSTEM_PROMPT,
        additionalSkillPaths: existing([
          join(agentDir, "skills"),
          join(cwd, ".helix", "skills"),
        ]),
        additionalPromptTemplatePaths: existing([
          join(agentDir, "prompts"),
          join(cwd, ".helix", "prompts"),
        ]),
      },
    });

    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      tools: toolNames,
      customTools: parentTools,
    });
    return { ...created, services, diagnostics: services.diagnostics };
  };

  await mkdir(options.paths.sessionDir, { recursive: true, mode: 0o700 });
  const sessionManager = SessionManager.create(options.cwd, options.paths.sessionDir);
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sessionManager.getCwd(),
    agentDir: options.paths.agentDir,
    sessionManager,
  });

  for (const diagnostic of runtime.diagnostics) {
    const output = diagnostic.type === "error" ? process.stderr : process.stdout;
    output.write(`[${diagnostic.type}] ${diagnostic.message}\n`);
  }
  const fatal = runtime.diagnostics.find((diagnostic) => diagnostic.type === "error");
  if (fatal) {
    await runtime.dispose();
    throw new Error(fatal.message);
  }

  initTheme(runtime.services.settingsManager.getTheme(), true);
  const mode = new InteractiveMode(runtime, {
    modelFallbackMessage: runtime.modelFallbackMessage,
  });

  try {
    await mode.run();
  } catch (error) {
    mode.stop();
    await runtime.dispose();
    throw error;
  }
}
