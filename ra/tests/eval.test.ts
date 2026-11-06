import { describe, expect, test } from "bun:test";
import { configuredModels, formatEvalResults, EVAL_TASKS } from "../src/eval.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

const config: RaConfig = {
  model: "ollama-cloud/glm-5.2",
  small_model: "ollama-lan/qwen3.8:latest",
  agent: {
    thoth: { model: "ollama-lan/qwen3.8:latest" },
    ptah: { model: "ollama-cloud/glm-5.2" },
    maat: { model: "ollama/gemma:latest" },
  },
};

describe("eval harness", () => {
  test("configuredModels dedupes unique models", () => {
    const models = configuredModels(config);
    expect(models).toContain("ollama-cloud/glm-5.2");
    expect(models).toContain("ollama-lan/qwen3.8:latest");
    expect(models).toContain("ollama/gemma:latest");
    expect(new Set(models).size).toBe(models.length);
  });

  test("EVAL_TASKS has at least 20 tasks", () => {
    expect(EVAL_TASKS.length).toBeGreaterThanOrEqual(20);
  });

  test("EVAL_TASKS cover multiple languages", () => {
    const prompts = EVAL_TASKS.map((t) => t.prompt.toLowerCase());
    expect(prompts.some((p) => p.includes("python"))).toBe(true);
    expect(prompts.some((p) => p.includes("javascript") || p.includes(".js"))).toBe(true);
    expect(prompts.some((p) => p.includes("html"))).toBe(true);
  });

  test("EVAL_TASKS all have verify functions", () => {
    for (const task of EVAL_TASKS) {
      expect(typeof task.verify).toBe("function");
      expect(task.name.length).toBeGreaterThan(0);
      expect(task.prompt.length).toBeGreaterThan(0);
    }
  });

  test("formatEvalResults renders a table and pass rate", () => {
    const results = [
      { task: "hello-function", model: "ollama-lan/qwen3.8:latest", passed: true, latencyMs: 100, cost: 0 },
      { task: "sum-function", model: "ollama-lan/qwen3.8:latest", passed: false, latencyMs: 200, cost: 0 },
    ];
    const text = formatEvalResults(results);
    expect(text).toContain("RA eval");
    expect(text).toContain("pass rate by model");
    expect(text).toContain("1/2");
  });

  test("formatEvalResults empty", () => {
    expect(formatEvalResults([])).toContain("No eval results");
  });
});
