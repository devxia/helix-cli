import { createHelixPaths } from "./paths.js";
import { configurePiEnvironment, preparePiRuntimeAssets } from "./runtime-assets.js";

const HELP = `Helix CLI 0.1.0\n\nUsage:\n  helix             Start the interactive scientific agent\n  helix --help      Show this help\n  helix --version   Show the version\n\nHelix stores isolated settings, sessions, and managed tools under ~/.helix.\n`;

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write("helix 0.1.0\n");
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
