import { defineTool, type AgentToolUpdateCallback, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  DelegateParameters,
  MAX_PARALLEL_SPECIALISTS,
  MAX_PREVIOUS_RESULT_CHARS,
  parseDelegationPlan,
} from "./contract.js";
import { specialistRole } from "./roles.js";
import {
  SPECIALIST_PROTOCOL_VERSION,
  type DelegationDetails,
  type DelegationPlan,
  type DelegationStatus,
  type HelixThinkingLevel,
  type SpecialistLaunchRequest,
  type SpecialistLauncher,
  type SpecialistRunResult,
  type SpecialistStep,
} from "./types.js";

const MAX_PARENT_RESULT_CHARS = 65_536;
const MAX_PARENT_RESULT_PER_RUN_CHARS = 12_288;
const MAX_DETAIL_OUTPUT_PER_RUN_CHARS = 4_096;
const MAX_DETAIL_ERROR_PER_RUN_CHARS = 2_048;

export interface CreateDelegateToolOptions {
  readonly launch: SpecialistLauncher;
  readonly createId?: () => string;
}

function safeConfirmationText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim();
}

function writerAuthorizationMessage(plan: DelegationPlan, cwd: string): string {
  const tasks = plan.steps
    .filter((step) => specialistRole(step.agent).canWrite)
    .map((step, index) => `${index + 1}. ${safeConfirmationText(step.task).slice(0, 500)}`)
    .join("\n");
  return `A Development Worker requested full bash/edit/write access for this Delegation Run.

Starting directory: ${safeConfirmationText(cwd)}

Worker tasks:
${tasks}

This is not a sandbox. Shell commands run with your current user permissions and can access paths outside the starting directory. This authorization applies only to this Delegation Run.`;
}

function failedResult(request: SpecialistLaunchRequest, error: unknown): SpecialistRunResult {
  return {
    id: request.specialistRunId,
    role: request.role,
    status: "failed",
    output: "",
    outputTruncated: false,
    durationMs: 0,
    error: error instanceof Error ? error.message : String(error),
  };
}

function statusFor(plan: DelegationPlan, runs: readonly SpecialistRunResult[]): DelegationStatus {
  const completed = runs.filter((run) => run.status === "completed").length;
  if (completed === runs.length) return "completed";
  if (runs.some((run) => run.status === "cancelled")) return "cancelled";
  if (plan.mode === "parallel" && completed > 0) return "partial_failure";
  return "failed";
}

function statusLabel(status: DelegationStatus): string {
  return status === "partial_failure" ? "PARTIAL FAILURE" : status.toUpperCase();
}

function bounded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 24))}\n… [preview truncated]`;
}

function resultPreview(run: SpecialistRunResult): SpecialistRunResult {
  const output = bounded(run.output, MAX_DETAIL_OUTPUT_PER_RUN_CHARS);
  const error = run.error === undefined ? undefined : bounded(run.error, MAX_DETAIL_ERROR_PER_RUN_CHARS);
  return {
    ...run,
    output,
    outputTruncated: run.outputTruncated || output !== run.output,
    ...(error === undefined ? {} : { error }),
  };
}

function resultText(details: DelegationDetails): string {
  const perRunLimit = Math.min(
    MAX_PARENT_RESULT_PER_RUN_CHARS,
    Math.max(1_024, Math.floor(MAX_PARENT_RESULT_CHARS / Math.max(1, details.runs.length))),
  );
  const sections = details.runs.map((run, index) => {
    const body = run.status === "completed" ? bounded(run.output, perRunLimit) : run.error ?? run.status;
    const record = run.sessionFile ? `\nRecord: ${run.sessionFile}` : "";
    return `## ${index + 1}. ${run.role} — ${run.status}\n${body}${record}`;
  });
  return bounded(
    `Delegation ${statusLabel(details.status)} (${details.mode}, ${details.runs.length} Specialist Run${details.runs.length === 1 ? "" : "s"})\n\n${sections.join("\n\n")}`,
    MAX_PARENT_RESULT_CHARS,
  );
}

function progress(
  plan: DelegationPlan,
  delegationId: string,
  runs: readonly SpecialistRunResult[],
  startedAt: number,
  onUpdate: AgentToolUpdateCallback<DelegationDetails> | undefined,
): void {
  onUpdate?.({
    content: [{ type: "text", text: `Delegation running: ${runs.length}/${plan.steps.length} Specialist Runs finished` }],
    details: {
      delegationId,
      mode: plan.mode,
      status: "running",
      runs: runs.map(resultPreview),
      durationMs: Math.round(performance.now() - startedAt),
    },
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index]!, index);
    }
  }));
  return results;
}

function modelSelection(ctx: Parameters<ToolDefinition["execute"]>[4]): SpecialistLaunchRequest["model"] {
  if (!ctx.model) throw new Error("Delegation requires an active parent model");
  return {
    provider: ctx.model.provider,
    id: ctx.model.id,
    thinkingLevel: (ctx.thinkingLevel ?? "off") as HelixThinkingLevel,
  };
}

export function createDelegateTool(options: CreateDelegateToolOptions): ToolDefinition {
  const createId = options.createId ?? (() => crypto.randomUUID());
  return defineTool({
    name: "delegate",
    label: "Delegate",
    description: "Delegate bounded work to one or more fixed Helix Specialist Agents. Use mode=single for one task, mode=parallel for independent read-only tasks, or mode=chain for sequential tasks whose next step receives the previous result. scientist/scout/planner/reviewer are read-only. worker has full development tools, requires interactive user authorization, and is forbidden in parallel mode.",
    promptSnippet: "Delegate bounded scientific, discovery, planning, review, or authorized code-development work to Specialist Agents",
    promptGuidelines: [
      "Use delegate when an independent Specialist context materially improves the result; do not delegate trivial work.",
      "Keep each task self-contained because Specialist Agents do not inherit the parent conversation.",
      "Use parallel only for independent read-only work. Use chain when later work depends on an earlier result or workspace change.",
      "Treat Specialist outputs as advisory evidence that the parent Helix Agent must evaluate and integrate.",
    ],
    parameters: DelegateParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const plan = parseDelegationPlan(params);
      const model = modelSelection(ctx);
      const workers = plan.steps.filter((step) => specialistRole(step.agent).canWrite);
      if (workers.length > 0) {
        if (!ctx.hasUI) throw new Error("Development Worker requires an interactive Writer Authorization");
        const authorized = await ctx.ui.confirm(
          "Authorize Development Worker?",
          writerAuthorizationMessage(plan, ctx.cwd),
        );
        if (!authorized) throw new Error("Writer Authorization was declined; no Specialist Run was started");
      }

      const delegationId = createId();
      const startedAt = performance.now();
      const finished: SpecialistRunResult[] = [];
      ctx.ui.setWorkingMessage(`Running ${plan.steps.length} Specialist Agent${plan.steps.length === 1 ? "" : "s"}`);

      const launch = async (step: SpecialistStep, previousResult?: string): Promise<SpecialistRunResult> => {
        if (signal?.aborted) throw new Error("Delegation was cancelled");
        const request: SpecialistLaunchRequest = {
          protocolVersion: SPECIALIST_PROTOCOL_VERSION,
          delegationId,
          specialistRunId: createId(),
          role: step.agent,
          task: step.task,
          ...(previousResult === undefined ? {} : {
            previousResult: bounded(previousResult, MAX_PREVIOUS_RESULT_CHARS),
          }),
          cwd: ctx.cwd,
          model,
        };
        let result: SpecialistRunResult;
        try {
          result = await options.launch(request, { signal });
        } catch (error) {
          if (signal?.aborted) throw new Error("Delegation was cancelled", { cause: error });
          result = failedResult(request, error);
        }
        finished.push(result);
        progress(plan, delegationId, [...finished], startedAt, onUpdate);
        return result;
      };

      try {
        let runs: SpecialistRunResult[];
        if (plan.mode === "single") {
          runs = [await launch(plan.steps[0]!)];
        } else if (plan.mode === "parallel") {
          runs = await mapWithConcurrency(plan.steps, MAX_PARALLEL_SPECIALISTS, (step) => launch(step));
        } else {
          runs = [];
          let previousResult: string | undefined;
          for (const step of plan.steps) {
            const result = await launch(step, previousResult);
            runs.push(result);
            if (result.status !== "completed") break;
            previousResult = result.output;
          }
        }

        const status = statusFor(plan, runs);
        const details: DelegationDetails = {
          delegationId,
          mode: plan.mode,
          status,
          runs: runs.map(resultPreview),
          durationMs: Math.round(performance.now() - startedAt),
        };
        return {
          content: [{ type: "text", text: resultText({ ...details, runs }) }],
          details,
        };
      } catch (error) {
        if (signal?.aborted) {
          onUpdate?.({
            content: [{ type: "text", text: "Delegation cancelled; active Specialist processes were terminated." }],
            details: {
              delegationId,
              mode: plan.mode,
              status: "cancelled",
              runs: finished.map(resultPreview),
              durationMs: Math.round(performance.now() - startedAt),
            },
          });
          throw new Error("Delegation was cancelled", { cause: error });
        }
        throw error;
      } finally {
        ctx.ui.setWorkingMessage();
      }
    },
  });
}
