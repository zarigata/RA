import { describe, expect, test } from "bun:test";
import {
  validateStages,
  DEFAULT_PIPELINE_STAGES,
  planPipeline,
  ORCHESTRATOR,
} from "../src/pipeline.ts";

describe("pipeline validation", () => {
  test("rejects orchestrator in stages (prevents loop)", () => {
    expect(validateStages(["anubis", "ptah"])).toBe(false);
    expect(validateStages([ORCHESTRATOR])).toBe(false);
  });
  test("accepts valid stages", () => {
    expect(validateStages(["thoth", "ptah", "maat"])).toBe(true);
  });
  test("rejects empty stages", () => {
    expect(validateStages([])).toBe(false);
  });
  test("default stages are valid", () => {
    expect(validateStages(DEFAULT_PIPELINE_STAGES)).toBe(true);
  });
  test("default stages do not contain orchestrator", () => {
    expect(DEFAULT_PIPELINE_STAGES).not.toContain(ORCHESTRATOR);
  });
});

describe("planPipeline", () => {
  test("produces plan for valid stages", () => {
    const plan = planPipeline("fix bug");
    expect(plan).not.toBeNull();
    expect(plan!.task).toBe("fix bug");
    expect(plan!.stages.length).toBeGreaterThan(0);
  });
  test("returns null for invalid stages", () => {
    expect(planPipeline("x", ["anubis"])).toBeNull();
    expect(planPipeline("x", [])).toBeNull();
  });
});
