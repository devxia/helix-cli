import { SPECIALIST_CHILD_ENV } from "./delegate/process.js";
import { createHelixPaths, HELIX_VERSION } from "./paths.js";
import { formatUpdateResult, runHelixUpdate } from "./update/update.js";
import { configurePiEnvironment, preparePiRuntimeAssets } from "./runtime-assets.js";

const HELP = `Helix CLI ${HELIX_VERSION}\n\nUsage:\n  helix             Start the interactive scientific agent\n  helix --help      Show this help\n  helix --version   Show the version\n\n  helix update      Check the latest stable release and upgrade this binary\n\nHelix stores isolated settings, sessions, and managed tools under ~/.helix.\n`;

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  if (process.env[SPECIALIST_CHILD_ENV] === "1") {
    if (args.length > 0) throw new Error("Specialist child mode does not accept command-line arguments");
    delete process.env[SPECIALIST_CHILD_ENV];
    const cwd = process.cwd();
    const paths = createHelixPaths(cwd);
    await preparePiRuntimeAssets(paths);
    configurePiEnvironment(paths);
    const { runSpecialistChildProcess } = await import("./delegate/child.js");
    return runSpecialistChildProcess(paths);
  }

  if (args.length === 1 && args[0] === "update") {
    const result = await runHelixUpdate();
    process.stdout.write(formatUpdateResult(result));
    return 0;
  }

  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`helix ${HELIX_VERSION}\n`);
    return 0;
  }

  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (args.length > 0) {
    process.stderr.write(`Unknown argument: ${args[0]}\n\n${HELP}`);
    return 2;
  }

  const cwd = process.cwd();
  const paths = createHelixPaths(cwd);
  await preparePiRuntimeAssets(paths);
  configurePiEnvironment(paths);

  // Pi reads branding/config constants during module initialization, so it must
  // be imported only after the isolated runtime package has been prepared.
  const { runHelixApp } = await import("./app.js");
  await runHelixApp({ cwd, paths });
  return 0;
}

if (import.meta.main) {
  runCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Helix failed: ${message}\n`);
      process.exitCode = 1;
    });
}
