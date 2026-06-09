import { HelixApp } from "./tui/app.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--version")) {
    console.log("helix 0.0.2");
    process.exit(0);
  }

  const app = new HelixApp();
  await app.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
