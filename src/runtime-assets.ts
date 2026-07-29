import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import darkTheme from "./assets/pi/dark.json" with { type: "json" };
import lightTheme from "./assets/pi/light.json" with { type: "json" };
import exportCss from "./assets/pi/export-html/template.css.txt" with { type: "text" };
import exportHtml from "./assets/pi/export-html/template.html.txt" with { type: "text" };
import exportJs from "./assets/pi/export-html/template.js.txt" with { type: "text" };
import highlightJs from "./assets/pi/export-html/vendor/highlight.min.js.txt" with { type: "text" };
import markedJs from "./assets/pi/export-html/vendor/marked.min.js.txt" with { type: "text" };
import modelDocs from "./assets/pi/models.md.txt" with { type: "text" };
import providerDocs from "./assets/pi/providers.md.txt" with { type: "text" };
import { HELIX_VERSION, type HelixPaths } from "./paths.js";

const PACKAGE_JSON = `${JSON.stringify(
  {
    name: "helix",
    version: HELIX_VERSION,
    type: "module",
    piConfig: { name: "helix", configDir: ".helix" },
  },
  null,
  2,
)}\n`;

const CHANGELOG = `# Changelog\n\n## [${HELIX_VERSION}]\n\n- Embed the Pi Agent runtime.\n- Add controlled FASTX and BAM inspection with SeqKit.\n`;

async function writePrivateFile(path: string, content: string): Promise<void> {
  let current: string | undefined;
  try {
    current = await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  if (current === content) {
    await chmod(path, 0o600);
    return;
  }

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function preparePiRuntimeAssets(paths: HelixPaths): Promise<void> {
  await mkdir(paths.agentDir, { recursive: true, mode: 0o700 });
  await Promise.all([
    writePrivateFile(join(paths.runtimeDir, "package.json"), PACKAGE_JSON),
    writePrivateFile(join(paths.runtimeDir, "CHANGELOG.md"), CHANGELOG),
    writePrivateFile(join(paths.runtimeDir, "docs", "providers.md"), providerDocs),
    writePrivateFile(join(paths.runtimeDir, "docs", "models.md"), modelDocs),
    writePrivateFile(join(paths.runtimeDir, "theme", "dark.json"), `${JSON.stringify(darkTheme, null, 2)}\n`),
    writePrivateFile(join(paths.runtimeDir, "theme", "light.json"), `${JSON.stringify(lightTheme, null, 2)}\n`),
    writePrivateFile(join(paths.runtimeDir, "export-html", "template.html"), exportHtml),
    writePrivateFile(join(paths.runtimeDir, "export-html", "template.css"), exportCss),
    writePrivateFile(join(paths.runtimeDir, "export-html", "template.js"), exportJs),
    writePrivateFile(join(paths.runtimeDir, "export-html", "vendor", "highlight.min.js"), highlightJs),
    writePrivateFile(join(paths.runtimeDir, "export-html", "vendor", "marked.min.js"), markedJs),
  ]);
}

export function configurePiEnvironment(paths: HelixPaths): void {
  process.env.PI_PACKAGE_DIR = paths.runtimeDir;
  process.env.HELIX_CODING_AGENT_DIR = paths.agentDir;
  // Helix versions the embedded Pi runtime itself; Pi's upstream CLI update
  // notice would compare unrelated Helix and Pi version numbers.
  process.env.PI_SKIP_VERSION_CHECK = "1";
}
