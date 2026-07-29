import { Type } from "typebox";
import { isSpecialistRoleName } from "./roles.js";
import type { DelegationMode, DelegationPlan, SpecialistRoleName, SpecialistStep } from "./types.js";

export const MAX_SPECIALIST_RUNS = 8;
export const MAX_PARALLEL_SPECIALISTS = 4;
export const MAX_SPECIALIST_TASK_CHARS = 16_384;
export const MAX_PREVIOUS_RESULT_CHARS = 65_536;
export const SPECIALIST_TIMEOUT_MS = 30 * 60 * 1_000;

const RoleNameSchema = Type.Union([
  Type.Literal("scientist"),
  Type.Literal("scout"),
  Type.Literal("planner"),
  Type.Literal("reviewer"),
  Type.Literal("worker"),
]);

const StepSchema = Type.Object({
  agent: RoleNameSchema,
  task: Type.String({ minLength: 1, maxLength: MAX_SPECIALIST_TASK_CHARS }),
}, { additionalProperties: false });

export const DelegateParameters = Type.Object({
  mode: Type.Union([Type.Literal("single"), Type.Literal("parallel"), Type.Literal("chain")]),
  agent: Type.Optional(RoleNameSchema),
  task: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_SPECIALIST_TASK_CHARS })),
  tasks: Type.Optional(Type.Array(StepSchema, { minItems: 1, maxItems: MAX_SPECIALIST_RUNS })),
  chain: Type.Optional(Type.Array(StepSchema, { minItems: 1, maxItems: MAX_SPECIALIST_RUNS })),
}, { additionalProperties: false });

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error(`${label} must contain only ${expected.join(" and ")}`);
  }
}

function task(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Specialist task must be a non-empty string");
  }
  if (value.length > MAX_SPECIALIST_TASK_CHARS) {
    throw new Error(`Specialist task must contain at most ${MAX_SPECIALIST_TASK_CHARS} characters`);
  }
  return value;
}

function role(value: unknown): SpecialistRoleName {
  if (!isSpecialistRoleName(value)) throw new Error(`Unknown Specialist Agent: ${String(value)}`);
  return value;
}

function step(value: unknown, label: string): SpecialistStep {
  const parsed = object(value, label);
  exactKeys(parsed, ["agent", "task"], label);
  return { agent: role(parsed.agent), task: task(parsed.task) };
}

function steps(value: unknown, label: string): SpecialistStep[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must contain at least one Specialist Run`);
  if (value.length > MAX_SPECIALIST_RUNS) throw new Error(`${label} may contain at most ${MAX_SPECIALIST_RUNS} Specialist Runs`);
  return value.map((item, index) => step(item, `${label}[${index}]`));
}

function mode(value: unknown): DelegationMode {
  if (value !== "single" && value !== "parallel" && value !== "chain") {
    throw new Error(`Unknown Delegation mode: ${String(value)}`);
  }
  return value;
}

export function parseDelegationPlan(value: unknown): DelegationPlan {
  const parsed = object(value, "delegate input");
  const parsedMode = mode(parsed.mode);

  if (parsedMode === "single") {
    exactKeys(parsed, ["mode", "agent", "task"], "single mode input");
    return { mode: parsedMode, steps: [{ agent: role(parsed.agent), task: task(parsed.task) }] };
  }

  const field = parsedMode === "parallel" ? "tasks" : "chain";
  exactKeys(parsed, ["mode", field], `${parsedMode} mode input`);
  const parsedSteps = steps(parsed[field], `${parsedMode} ${field}`);
  if (parsedMode === "parallel" && parsedSteps.some((item) => item.agent === "worker")) {
    throw new Error("parallel mode does not allow worker; use single or chain for Development Worker tasks");
  }
  return { mode: parsedMode, steps: parsedSteps };
}
