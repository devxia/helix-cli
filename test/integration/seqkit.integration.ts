import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProcess } from "../../src/executor/subprocess.js";
import { SeqkitManager } from "../../src/seqkit/manager.js";
import { parseBamStats, parseFastxStats } from "../../src/seqkit/parsers.js";

const root = await mkdtemp(join(tmpdir(), "helix-seqkit-integration-"));
const manager = new SeqkitManager({ toolsDir: join(root, "tools"), path: "" });

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("real SeqKit 2.13.0 integration", () => {
  test("downloads the verified release and inspects FASTA, FASTQ, and BAM", async () => {
    const seqkit = await manager.resolve(async () => true);
    expect(seqkit).toMatchObject({ version: "2.13.0", source: "managed" });

    const fasta = resolve("test/fixtures/tiny.fa");
    const fastq = resolve("test/fixtures/tiny.fq");
    const fastxRun = await runProcess([
      seqkit.path,
      "stats",
      "--all",
      "--tabular",
      "--quiet",
      fasta,
      fastq,
    ]);
    expect(fastxRun.exitCode).toBe(0);
    expect(fastxRun.stderr).toBe("");
    expect(parseFastxStats(fastxRun.stdout)).toEqual([
      expect.objectContaining({
        file: fasta,
        format: "FASTA",
        numSequences: 2,
        sumLength: 10,
        n50: 6,
        gcPercent: 60,
        q20Percent: null,
        q30Percent: null,
        averageQuality: null,
      }),
      expect.objectContaining({ file: fastq, format: "FASTQ", numSequences: 2, sumLength: 6, q30Percent: 67, averageQuality: 4.77 }),
    ]);

    const bam = resolve("test/fixtures/tiny.bam");
    const bamRun = await runProcess([seqkit.path, "bam", "-s", "--quiet", bam]);
    expect(bamRun.exitCode).toBe(0);
    expect(bamRun.stdout).toBe("");
    expect(parseBamStats(bamRun.stderr)).toMatchObject({
      file: bam,
      primaryAlignments: 1,
      secondaryAlignments: 4,
      totalReads: 1,
      totalRecords: 5,
    });
  }, 120_000);

  test("a malformed FASTQ diagnostic cannot be parsed as successful statistics", async () => {
    const seqkit = await manager.resolve(async () => true);
    const run = await runProcess([
      seqkit.path,
      "stats",
      "--all",
      "--tabular",
      "--quiet",
      resolve("test/fixtures/malformed.fq"),
    ]);
    // SeqKit 2.13.0 reports malformed FASTQ on stderr but still exits zero.
    // Helix therefore also requires a complete data row before accepting success.
    expect(run.stderr).toContain("[ERRO]");
    expect(() => parseFastxStats(run.stdout)).toThrow();
  }, 120_000);
});
