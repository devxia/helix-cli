import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SeqkitManager } from "../src/seqkit/manager.js";
import { createSeqkitTools } from "../src/seqkit/tools.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fakeSeqkitDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "helix-tools-test-"));
  temporaryDirectories.push(root);
  const executable = join(root, "seqkit");
  const script = `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === "version") {
  process.stdout.write("seqkit v2.13.0\\n");
} else if (args[0] === "stats") {
  const inputs = args.filter((value) => !value.startsWith("-") && value !== "stats");
  if (inputs.some((value) => value.includes("slow"))) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  if (inputs.some((value) => value.includes("malformed"))) {
    process.stdout.write("partial\\n");
    process.stderr.write("invalid FASTQ\\n");
    process.exit(1);
  }
  process.stdout.write("file\\tformat\\ttype\\tnum_seqs\\tsum_len\\tmin_len\\tavg_len\\tmax_len\\tQ1\\tQ2\\tQ3\\tsum_gap\\tN50\\tN50_num\\tQ20(%)\\tQ30(%)\\tAvgQual\\tGC(%)\\tsum_n\\n");
  for (const input of inputs) {
    const format = input.endsWith(".fq") ? "FASTQ" : "FASTA";
    process.stdout.write(input + "\\t" + format + "\\tDNA\\t2\\t10\\t4\\t5.0\\t6\\t4\\t5\\t6\\t0\\t6\\t1\\t50\\t40\\t20.0\\t60.0\\t2\\n");
  }
} else if (args[0] === "bam") {
  const input = args.at(-1);
  process.stderr.write("PrimAlnPerc\\tMultimapPerc\\tPrimAln\\tSecAln\\tSupAln\\tUnmapped\\tTotalReads\\tTotalRecords\\tFile\\t\\n");
  process.stderr.write("100.00\\t100.00\\t1\\t4\\t0\\t0\\t1\\t5\\t" + input + "\\t\\n");
} else {
  process.stderr.write("unsupported fake command\\n");
  process.exit(2);
}
`;
  await writeFile(executable, script, { mode: 0o700 });
  await chmod(executable, 0o700);
  return root;
}

function context(cwd: string) {
  return {
    cwd,
    hasUI: true,
    ui: {
      confirm: async () => {
        throw new Error("PATH SeqKit should not request confirmation");
      },
      setWorkingMessage: () => {},
    },
  } as any;
}

describe("SeqKit Agent Tools", () => {
  test("inspect_fastx and inspect_bam execute fixed argv and return structured details", async () => {
    const bin = await fakeSeqkitDirectory();
    const manager = new SeqkitManager({ toolsDir: join(bin, "tools"), path: bin });
    const tools = createSeqkitTools(manager);
    const fastx = tools.find((tool) => tool.name === "inspect_fastx")!;
    const bam = tools.find((tool) => tool.name === "inspect_bam")!;
    const cwd = process.cwd();

    const fastxResult = await fastx.execute(
      "fastx-call",
      { paths: ["test/fixtures/tiny.fa", "test/fixtures/tiny.fq"] },
      undefined,
      undefined,
      context(cwd),
    );
    expect(fastxResult.content[0]).toMatchObject({ type: "text" });
    expect((fastxResult.details as any).statistics).toHaveLength(2);
    expect((fastxResult.details as any).provenance.resolutionProbes).toEqual([
      expect.objectContaining({ argv: ["version"], outcome: "completed" }),
    ]);
    expect((fastxResult.details as any).provenance.argv.slice(0, 4)).toEqual([
      "stats", "--all", "--tabular", "--quiet",
    ]);

    const bamResult = await bam.execute(
      "bam-call",
      { path: resolve("test/fixtures/tiny.bam") },
      undefined,
      undefined,
      context(cwd),
    );
    expect((bamResult.details as any).statistics).toMatchObject({ totalReads: 1, totalRecords: 5 });
    expect((bamResult.details as any).provenance.argv.slice(0, 3)).toEqual(["bam", "-s", "--quiet"]);
  });

  test("does not return partial statistics after SeqKit failure", async () => {
    const bin = await fakeSeqkitDirectory();
    const manager = new SeqkitManager({ toolsDir: join(bin, "tools"), path: bin });
    const fastx = createSeqkitTools(manager).find((tool) => tool.name === "inspect_fastx")!;
    await expect(fastx.execute(
      "failed-call",
      { paths: ["test/fixtures/malformed.fq"] },
      undefined,
      undefined,
      context(process.cwd()),
    )).rejects.toThrow("Tool Run provenance");
  });

  test("records cancelled Tool Run provenance before rejecting", async () => {
    const bin = await fakeSeqkitDirectory();
    const slowInput = join(bin, "slow.fa");
    await writeFile(slowInput, ">slow\nACGT\n");
    const manager = new SeqkitManager({ toolsDir: join(bin, "tools"), path: bin });
    const fastx = createSeqkitTools(manager).find((tool) => tool.name === "inspect_fastx")!;
    const controller = new AbortController();
    const updates: any[] = [];

    await expect(fastx.execute(
      "cancelled-call",
      { paths: [slowInput] },
      controller.signal,
      (update) => {
        updates.push(update);
        if ((update.details as { status: string }).status === "running") controller.abort();
      },
      context(process.cwd()),
    )).rejects.toThrow('"outcome":"cancelled"');
    expect(updates.at(-1)?.details).toMatchObject({
      status: "cancelled",
      provenance: { outcome: "cancelled", exitCode: null },
    });
  });
});
