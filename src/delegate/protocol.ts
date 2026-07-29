import { isAbsolute, resolve } from "node:path";
import { MAX_PREVIOUS_RESULT_CHARS, MAX_SPECIALIST_TASK_CHARS } from "./contract.js";
import { isSpecialistRoleName } from "./roles.js";
import {
  SPECIALIST_PROTOCOL_VERSION,
  type HelixThinkingLevel,
  type SpecialistLaunchRequest,
  type SpecialistRunResult,
  type SpecialistUsage,
} from "./types.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const THINKING_LEVELS = new Set<HelixThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const RUN_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out"]);
const MAX_SPECIALIST_OUTPUT_CHARS = 65_536;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function fields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  for (const field of required) {
    if (!(field in value)) throw new Error(`${label} is missing ${field}`);
  }
  const allowed = new Set([...required, ...optional]);
  const unexpected = Object.keys(value).find((field) => !allowed.has(field));
  if (unexpected) throw new Error(`${label} contains unexpected field: ${unexpected}`);
}

function string(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  if (value.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return value;
}

function id(value: unknown, label: string): string {
  const parsed = string(value, label, 64);
  if (!SAFE_ID.test(parsed)) throw new Error(`${label} contains unsafe characters`);
  return parsed;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`);
  return value;
}

function usage(value: unknown): SpecialistUsage {
  const parsed = record(value, "Specialist usage");
  fields(parsed, ["input", "output", "cacheRead", "cacheWrite", "total", "cost"], [], "Specialist usage");
  return {
    input: finiteNumber(parsed.input, "usage.input"),
    output: finiteNumber(parsed.output, "usage.output"),
    cacheRead: finiteNumber(parsed.cacheRead, "usage.cacheRead"),
    cacheWrite: finiteNumber(parsed.cacheWrite, "usage.cacheWrite"),
    total: finiteNumber(parsed.total, "usage.total"),
    cost: finiteNumber(parsed.cost, "usage.cost"),
  };
}

export function parseSpecialistLaunchRequest(value: unknown): SpecialistLaunchRequest {
  const parsed = record(value, "Specialist child request");
  fields(
    parsed,
    ["protocolVersion", "delegationId", "specialistRunId", "role", "task", "cwd", "model"],
    ["previousResult"],
    "Specialist child request",
  );
  if (parsed.protocolVersion !== SPECIALIST_PROTOCOL_VERSION) throw new Error(`Unsupported Specialist protocol version: ${String(parsed.protocolVersion)}`);
  if (!isSpecialistRoleName(parsed.role)) throw new Error(`Unknown Specialist Agent: ${String(parsed.role)}`);
  const task = string(parsed.task, "task", MAX_SPECIALIST_TASK_CHARS);
  const cwd = string(parsed.cwd, "cwd", 4_096);
  if (!isAbsolute(cwd) || resolve(cwd) !== cwd) throw new Error("cwd must be an absolute normalized path");
  const model = record(parsed.model, "model");
  fields(model, ["provider", "id", "thinkingLevel"], [], "model");
  if (!THINKING_LEVELS.has(model.thinkingLevel as HelixThinkingLevel)) {
    throw new Error(`Unknown thinking level: ${String(model.thinkingLevel)}`);
  }
  let previousResult: string | undefined;
  if (parsed.previousResult !== undefined) {
    if (typeof parsed.previousResult !== "string" || parsed.previousResult.length > MAX_PREVIOUS_RESULT_CHARS) {
      throw new Error(`previousResult must be a string of at most ${MAX_PREVIOUS_RESULT_CHARS} characters`);
    }
    previousResult = parsed.previousResult;
  }
  return {
    protocolVersion: SPECIALIST_PROTOCOL_VERSION,
    delegationId: id(parsed.delegationId, "delegationId"),
    specialistRunId: id(parsed.specialistRunId, "specialistRunId"),
    role: parsed.role,
    task,
    ...(previousResult === undefined ? {} : { previousResult }),
    cwd,
    model: {
      provider: string(model.provider, "model.provider"),
      id: string(model.id, "model.id"),
      thinkingLevel: model.thinkingLevel as HelixThinkingLevel,
    },
  };
}

export function parseSpecialistRunResult(value: unknown, request: SpecialistLaunchRequest): SpecialistRunResult {
  const parsed = record(value, "Specialist child result");
  fields(
    parsed,
    ["id", "role", "status", "output", "outputTruncated", "durationMs"],
    ["sessionFile", "usage", "error"],
    "Specialist child result",
  );
  if (parsed.id !== request.specialistRunId) throw new Error("Specialist child result id does not match the request");
  if (parsed.role !== request.role) throw new Error("Specialist child result role does not match the request");
  if (!RUN_STATUSES.has(parsed.status as string)) throw new Error(`Unknown Specialist child status: ${String(parsed.status)}`);
  if (typeof parsed.output !== "string" || parsed.output.length > MAX_SPECIALIST_OUTPUT_CHARS) {
    throw new Error(`Specialist child output must be a string of at most ${MAX_SPECIALIST_OUTPUT_CHARS} characters`);
  }
  if (typeof parsed.outputTruncated !== "boolean") throw new Error("Specialist child outputTruncated must be boolean");
  let sessionFile: string | undefined;
  if (parsed.sessionFile !== undefined) {
    sessionFile = string(parsed.sessionFile, "sessionFile", 4_096);
    if (!isAbsolute(sessionFile)) throw new Error("sessionFile must be absolute");
  }
  let error: string | undefined;
  if (parsed.error !== undefined) error = string(parsed.error, "error", 16_384);
  return {
    id: request.specialistRunId,
    role: request.role,
    status: parsed.status as SpecialistRunResult["status"],
    output: parsed.output,
    outputTruncated: parsed.outputTruncated,
    ...(sessionFile === undefined ? {} : { sessionFile }),
    durationMs: finiteNumber(parsed.durationMs, "durationMs"),
    ...(parsed.usage === undefined ? {} : { usage: usage(parsed.usage) }),
    ...(error === undefined ? {} : { error }),
  };
}
