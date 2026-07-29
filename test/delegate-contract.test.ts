import { describe, expect, test } from "bun:test";
import { parseDelegationPlan } from "../src/delegate/contract.js";
import { SPECIALIST_ROLES, specialistRole } from "../src/delegate/roles.js";

describe("Specialist Agent contract", () => {
  test("ships five fixed roles with only worker receiving development tools", () => {
    expect(SPECIALIST_ROLES.map((role) => role.name)).toEqual([
      "scientist",
      "scout",
      "planner",
      "reviewer",
      "worker",
    ]);

    for (const name of ["scientist", "scout", "planner", "reviewer"] as const) {
      expect(specialistRole(name).canWrite).toBeFalse();
      expect(specialistRole(name).tools).not.toContain("bash");
      expect(specialistRole(name).tools).not.toContain("edit");
      expect(specialistRole(name).tools).not.toContain("write");
      expect(specialistRole(name).tools).not.toContain("delegate");
    }
    expect(specialistRole("worker")).toMatchObject({ canWrite: true });
    expect(specialistRole("worker").tools).toEqual(expect.arrayContaining(["bash", "edit", "write"]));
    expect(specialistRole("worker").tools).not.toContain("delegate");
  });

  test("parses exactly one of the three foreground modes", () => {
    expect(parseDelegationPlan({ mode: "single", agent: "scientist", task: "Inspect data" })).toEqual({
      mode: "single",
      steps: [{ agent: "scientist", task: "Inspect data" }],
    });
    expect(parseDelegationPlan({
      mode: "parallel",
      tasks: [
        { agent: "scout", task: "Map files" },
        { agent: "reviewer", task: "Check assumptions" },
      ],
    })).toEqual({
      mode: "parallel",
      steps: [
        { agent: "scout", task: "Map files" },
        { agent: "reviewer", task: "Check assumptions" },
      ],
    });
    expect(parseDelegationPlan({
      mode: "chain",
      chain: [
        { agent: "planner", task: "Plan" },
        { agent: "worker", task: "Implement the approved plan" },
      ],
    }).mode).toBe("chain");
  });

  test("rejects ambiguous, oversized, unknown, and parallel-writer plans", () => {
    expect(() => parseDelegationPlan({ mode: "single", agent: "scientist", task: "x", tasks: [] })).toThrow("only mode and agent and task");
    expect(() => parseDelegationPlan({ mode: "single", agent: "unknown", task: "x" })).toThrow("Unknown Specialist Agent");
    expect(() => parseDelegationPlan({ mode: "parallel", tasks: [{ agent: "worker", task: "edit" }] })).toThrow("parallel mode does not allow worker");
    expect(() => parseDelegationPlan({
      mode: "chain",
      chain: Array.from({ length: 9 }, () => ({ agent: "planner", task: "step" })),
    })).toThrow("at most 8");
    expect(() => parseDelegationPlan({ mode: "single", agent: "scientist", task: " ".repeat(10) })).toThrow("non-empty");
  });
});
