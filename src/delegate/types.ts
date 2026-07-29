export const SPECIALIST_PROTOCOL_VERSION = 1 as const;

export type SpecialistRoleName = "scientist" | "scout" | "planner" | "reviewer" | "worker";
export type DelegationMode = "single" | "parallel" | "chain";
export type SpecialistRunStatus = "completed" | "failed" | "cancelled" | "timed_out";
export type DelegationStatus = "running" | "completed" | "partial_failure" | "failed" | "cancelled";
export type HelixThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface SpecialistStep {
  readonly agent: SpecialistRoleName;
  readonly task: string;
}

export interface DelegationPlan {
  readonly mode: DelegationMode;
  readonly steps: readonly SpecialistStep[];
}

export interface SpecialistModelSelection {
  readonly provider: string;
  readonly id: string;
  readonly thinkingLevel: HelixThinkingLevel;
}

export interface SpecialistLaunchRequest {
  readonly protocolVersion: typeof SPECIALIST_PROTOCOL_VERSION;
  readonly delegationId: string;
  readonly specialistRunId: string;
  readonly role: SpecialistRoleName;
  readonly task: string;
  readonly previousResult?: string;
  readonly cwd: string;
  readonly model: SpecialistModelSelection;
}

export interface SpecialistUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
  readonly cost: number;
}

export interface SpecialistRunResult {
  readonly id: string;
  readonly role: SpecialistRoleName;
  readonly status: SpecialistRunStatus;
  readonly output: string;
  readonly outputTruncated: boolean;
  readonly sessionFile?: string;
  readonly durationMs: number;
  readonly usage?: SpecialistUsage;
  readonly error?: string;
}

export interface DelegationDetails {
  readonly delegationId: string;
  readonly mode: DelegationMode;
  readonly status: DelegationStatus;
  readonly runs: readonly SpecialistRunResult[];
  readonly durationMs: number;
}

export interface SpecialistLaunchOptions {
  readonly signal?: AbortSignal;
}

export type SpecialistLauncher = (
  request: SpecialistLaunchRequest,
  options: SpecialistLaunchOptions,
) => Promise<SpecialistRunResult>;
