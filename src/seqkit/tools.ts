import { access, realpath, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";
import { defineTool, type AgentToolUpdateCallback, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ProcessCancelledError, runProcess, type ProcessResult } from "../executor/subprocess.js";
import { SeqkitManager, type ResolvedSeqkit } from "./manager.js";
import { parseBamStats, parseFastxStats, type BamStats, type FastxStats } from "./parsers.js";

interface SeqkitProvenance {
  readonly executable: string;
  readonly version: string;
  readonly source: "path" | "managed";
  readonly argv: readonly string[];
  readonly inputs: readonly string[];
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly resolutionProbes: ResolvedSeqkit["resolutionProbes"];
  readonly diagnostics?: string;
}

interface InspectionDetails<T> {
  readonly status: "running" | "completed" | "failed" | "cancelled";
  readonly kind: "fastx" | "bam";
  readonly statistics?: T;
  readonly provenance?: SeqkitProvenance;
}

async function resolveReadableFile(input: string, cwd: string): Promise<string> {
  const absolutePath = resolve(cwd, input);
  const resolvedPath = await realpath(absolutePath).catch((error) => {
    throw new Error(`Input file does not exist: ${absolutePath}`, { cause: error });
  });
  const metadata = await stat(resolvedPath);
  if (!metadata.isFile()) throw new Error(`Input is not a regular file: ${resolvedPath}`);
  await access(resolvedPath, fsConstants.R_OK);
  return resolvedPath;
}

function boundedDiagnostic(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 4_096 ? trimmed : `${trimmed.slice(0, 4_096)}…`;
}

function commandFailure(result: ProcessResult): Error {
  const diagnostic = boundedDiagnostic(result.stderr) || boundedDiagnostic(result.stdout) || "No diagnostic output";
  return new Error(`SeqKit exited with status ${result.exitCode}: ${diagnostic}`);
}

function assertCompleteOutput(result: ProcessResult): void {
  if (result.exitCode !== 0) throw commandFailure(result);
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error("SeqKit output exceeded the capture limit; no partial statistics were returned.");
  }
}

function provenance(seqkit: ResolvedSeqkit, result: ProcessResult, inputs: string[]): SeqkitProvenance {
  const diagnostics = boundedDiagnostic(result.stderr);
  return {
    executable: seqkit.path,
    version: seqkit.version,
    source: seqkit.source,
    argv: result.command.slice(1),
    inputs,
    durationMs: Math.round(result.durationMs),
    exitCode: result.exitCode,
    outcome: "completed",
    resolutionProbes: seqkit.resolutionProbes,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function failedProvenance(
  seqkit: ResolvedSeqkit,
  command: string[],
  inputs: string[],
  startedAt: number,
  result: ProcessResult | undefined,
  error: unknown,
  outcome: "failed" | "cancelled",
): SeqkitProvenance {
  const resultDiagnostic = result ? boundedDiagnostic(result.stderr) || boundedDiagnostic(result.stdout) : "";
  const errorDiagnostic = error instanceof Error ? error.message : String(error);
  const diagnostics = boundedDiagnostic(resultDiagnostic || errorDiagnostic);
  return {
    executable: seqkit.path,
    version: seqkit.version,
    source: seqkit.source,
    argv: command.slice(1),
    inputs,
    durationMs: result ? Math.round(result.durationMs) : Math.round(performance.now() - startedAt),
    exitCode: result?.exitCode ?? null,
    outcome,
    resolutionProbes: seqkit.resolutionProbes,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function startProgress<T>(
  label: string,
  details: InspectionDetails<T>,
  onUpdate: AgentToolUpdateCallback<InspectionDetails<T>> | undefined,
): () => void {
  const startedAt = Date.now();
  const update = () => onUpdate?.({
    content: [{ type: "text", text: `${label} (${Math.round((Date.now() - startedAt) / 1_000)}s)` }],
    details,
  });
  update();
  const timer = setInterval(update, 1_000);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function resolveSeqkit(
  manager: SeqkitManager,
  signal: AbortSignal | undefined,
  ctx: Parameters<ToolDefinition["execute"]>[4],
): Promise<ResolvedSeqkit> {
  return manager.resolve(async ({ title, message }) => {
    if (!ctx.hasUI) return false;
    return ctx.ui.confirm(title, message);
  }, signal);
}

export function createSeqkitTools(manager: SeqkitManager): ToolDefinition[] {
  const inspectFastx = defineTool({
    name: "inspect_fastx",
    label: "Inspect FASTX",
    description: "Inspect one to 32 local FASTA or FASTQ files with SeqKit and return per-file sequence, length, N50, GC, N/n count, and FASTQ-only quality statistics. Inputs may use gzip, xz, zstd, bzip2, or lz4 compression. This tool never modifies input files.",
    promptSnippet: "Inspect FASTA/FASTQ datasets with structured SeqKit statistics",
    promptGuidelines: [
      "Use inspect_fastx only for FASTA or FASTQ data, not BAM/SAM/CRAM/VCF.",
      "Pass file paths directly; do not ask for or construct shell commands.",
    ],
    parameters: Type.Object({
      paths: Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 32,
        description: "One to 32 FASTA/FASTQ file paths. Relative paths resolve from the Helix working directory.",
      }),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const inputs = await Promise.all(params.paths.map((path) => resolveReadableFile(path, ctx.cwd)));
      if (new Set(inputs).size !== inputs.length) throw new Error("inspect_fastx received the same file more than once");

      ctx.ui.setWorkingMessage("Preparing SeqKit FASTX inspection");
      let stopProgress = () => {};
      try {
        const seqkit = await resolveSeqkit(manager, signal, ctx);
        const command = [seqkit.path, "stats", "--all", "--tabular", "--quiet", ...inputs];
        stopProgress = startProgress<FastxStats[]>(
          "Inspecting FASTX files",
          { status: "running", kind: "fastx" },
          onUpdate,
        );
        ctx.ui.setWorkingMessage("Inspecting FASTX files with SeqKit");
        const startedAt = performance.now();
        let result: ProcessResult | undefined;
        try {
          result = await runProcess(command, { signal, maxOutputBytes: 1_048_576 });
          assertCompleteOutput(result);
          const statistics = parseFastxStats(result.stdout);
          if (statistics.length !== inputs.length) {
            throw new Error(`SeqKit returned ${statistics.length} rows for ${inputs.length} input files`);
          }
          const details: InspectionDetails<FastxStats[]> = {
            status: "completed",
            kind: "fastx",
            statistics,
            provenance: provenance(seqkit, result, inputs),
          };
          const summary = statistics.map((item) =>
            `${item.file}: ${item.format} ${item.sequenceType}, ${item.numSequences} sequences, ${item.sumLength} total bases/residues, GC ${item.gcPercent}%`,
          ).join("\n");
          return { content: [{ type: "text", text: summary }], details };
        } catch (error) {
          const status = error instanceof ProcessCancelledError || signal?.aborted ? "cancelled" : "failed";
          const runProvenance = failedProvenance(seqkit, command, inputs, startedAt, result, error, status);
          onUpdate?.({
            content: [{ type: "text", text: `SeqKit FASTX inspection ${status}.` }],
            details: { status, kind: "fastx", provenance: runProvenance },
          });
          throw new Error(`${error instanceof Error ? error.message : String(error)}\nTool Run provenance: ${JSON.stringify(runProvenance)}`, { cause: error });
        }
      } finally {
        stopProgress();
        ctx.ui.setWorkingMessage();
      }
    },
  });

  const inspectBam = defineTool({
    name: "inspect_bam",
    label: "Inspect BAM",
    description: "Scan one local BAM alignment file with SeqKit and return detailed primary, secondary, supplementary, unmapped, read, and record statistics. This tool does not use an index and never modifies the BAM file.",
    promptSnippet: "Inspect one BAM alignment dataset with detailed SeqKit statistics",
    promptGuidelines: [
      "Use inspect_bam only for BAM data; SAM and CRAM are unsupported.",
      "A large BAM is scanned completely and may take time; report that fact to the user.",
    ],
    parameters: Type.Object({
      path: Type.String({
        minLength: 1,
        description: "One BAM file path. Relative paths resolve from the Helix working directory.",
      }),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = await resolveReadableFile(params.path, ctx.cwd);
      ctx.ui.setWorkingMessage("Preparing SeqKit BAM inspection");
      let stopProgress = () => {};
      try {
        const seqkit = await resolveSeqkit(manager, signal, ctx);
        const command = [seqkit.path, "bam", "-s", "--quiet", input];
        stopProgress = startProgress<BamStats>(
          "Scanning BAM records",
          { status: "running", kind: "bam" },
          onUpdate,
        );
        ctx.ui.setWorkingMessage("Scanning BAM records with SeqKit");
        const startedAt = performance.now();
        let result: ProcessResult | undefined;
        try {
          result = await runProcess(command, { signal, maxOutputBytes: 1_048_576 });
          assertCompleteOutput(result);
          if (result.stdout.trim()) throw new Error("SeqKit BAM statistics unexpectedly wrote data to stdout");
          const statistics = parseBamStats(result.stderr);
          const details: InspectionDetails<BamStats> = {
            status: "completed",
            kind: "bam",
            statistics,
            provenance: provenance(seqkit, { ...result, stderr: "" }, [input]),
          };
          const primaryPercent = statistics.primaryAlignmentPercent === null ? "n/a" : `${statistics.primaryAlignmentPercent}%`;
          const summary = `${statistics.file}: ${statistics.totalReads} reads, ${statistics.totalRecords} alignment records, ${statistics.primaryAlignments} primary alignments (${primaryPercent}), ${statistics.unmappedReads} unmapped reads`;
          return { content: [{ type: "text", text: summary }], details };
        } catch (error) {
          const status = error instanceof ProcessCancelledError || signal?.aborted ? "cancelled" : "failed";
          const runProvenance = failedProvenance(seqkit, command, [input], startedAt, result, error, status);
          onUpdate?.({
            content: [{ type: "text", text: `SeqKit BAM inspection ${status}.` }],
            details: { status, kind: "bam", provenance: runProvenance },
          });
          throw new Error(`${error instanceof Error ? error.message : String(error)}\nTool Run provenance: ${JSON.stringify(runProvenance)}`, { cause: error });
        }
      } finally {
        stopProgress();
        ctx.ui.setWorkingMessage();
      }
    },
  });

  return [inspectFastx, inspectBam];
}
