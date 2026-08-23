// Eval harness — run real coding tasks against every configured model and
// record pass rate, latency, and cost. This is how RA proves it works with
// local models, not just claims it.

import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTaskAgent } from "./agent.ts";
import { loadEnv } from "../../anubis/src/env.ts";
import { loadUsage, estimateCost } from "../../anubis/src/cost.ts";
import { ANUBIS_HOME } from "./paths.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import type { ToolContext } from "./tools/index.ts";

export interface EvalTask {
  name: string;
  prompt: string;
  /** Verify the result in the task's working directory. */
  verify: (cwd: string) => boolean;
}

export interface EvalResult {
  task: string;
  model: string;
  passed: boolean;
  latencyMs: number;
  cost: number;
}

/** A small, deterministic set of real coding tasks. */
export const EVAL_TASKS: EvalTask[] = [
  {
    name: "hello-function",
    prompt: "Write a Python function hello() that prints 'Hello, World!' and call it under __main__.",
    verify: (cwd) => {
      const p = join(cwd, "hello.py");
      return existsSync(p) && /print\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "sum-function",
    prompt: "Write a Python function add(a, b) that returns a + b.",
    verify: (cwd) => {
      const p = join(cwd, "hello.py");
      return existsSync(p) && /def add\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "html-page",
    prompt: "Create an index.html page with a <h1>Hello</h1> heading.",
    verify: (cwd) => {
      const p = join(cwd, "index.html");
      return existsSync(p) && /<h1>hello<\/h1>/i.test(readFileSync(p, "utf-8"));
    },
  },
];

/** Enumerate the unique models configured for the agent roles. */
export function configuredModels(config: RaConfig): string[] {
  const set = new Set<string>();
  if (config.model) set.add(config.model);
  if (config.small_model) set.add(config.small_model);
  for (const role of Object.values(config.agent ?? {})) {
    if (role.model) set.add(role.model);
  }
  return [...set];
}

/** Run one task against one model in a fresh temp dir. */
export async function runEvalTask(
  task: EvalTask,
  model: string,
  config: RaConfig,
  env: Record<string, string>,
): Promise<EvalResult> {
  const cwd = mkdtempSync(join(tmpdir(), "ra-eval-"));
  const ctx: ToolContext = { cwd };
  const before = loadUsage();
  const t0 = Date.now();
  let passed = false;
  try {
    // Force the model by overriding the ptah role assignment.
    const cfg: RaConfig = { ...config, agent: { ...config.agent, ptah: { model } } };
    await runTaskAgent("ptah", task.prompt, cfg, ctx, env, 6);
    passed = task.verify(cwd);
  } catch {
    passed = false;
  }
  const latencyMs = Date.now() - t0;
  const after = loadUsage();
  // Cost delta for this run (approximate: any new usage since before).
  let cost = 0;
  for (const [m, u] of Object.entries(after)) {
    const prev = before[m];
    const inDelta = u.inputTokens - (prev?.inputTokens ?? 0);
    const outDelta = u.outputTokens - (prev?.outputTokens ?? 0);
    if (inDelta > 0 || outDelta > 0) cost += estimateCost(m, inDelta, outDelta);
  }
  rmSync(cwd, { recursive: true, force: true });
  return { task: task.name, model, passed, latencyMs, cost };
}

/** Run all tasks against all configured models. */
export async function runEval(
  config: RaConfig,
  env: Record<string, string>,
  tasks: EvalTask[] = EVAL_TASKS,
): Promise<EvalResult[]> {
  const models = configuredModels(config);
  const results: EvalResult[] = [];
  for (const model of models) {
    for (const task of tasks) {
      results.push(await runEvalTask(task, model, config, env));
    }
  }
  return results;
}

/** Format eval results as a table. */
export function formatEvalResults(results: EvalResult[]): string {
  if (!results.length) return "No eval results.";
  const lines = ["RA eval", "model | task | pass | latency | cost"];
  for (const r of results) {
    lines.push(`${r.model} | ${r.task} | ${r.passed ? "✓" : "✗"} | ${r.latencyMs}ms | $${r.cost.toFixed(6)}`);
  }
  const byModel = new Map<string, EvalResult[]>();
  for (const r of results) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }
  lines.push("");
  lines.push("pass rate by model:");
  for (const [model, rs] of byModel) {
    const pass = rs.filter((r) => r.passed).length;
    lines.push(`  ${model}: ${pass}/${rs.length} (${((pass / rs.length) * 100).toFixed(0)}%)`);
  }
  return lines.join("\n");
}

/** Convenience: load config + env and run the eval. */
export async function runEvalCli(): Promise<string> {
  const { loadRaConfig } = await import("../../anubis/src/config.ts");
  const config = loadRaConfig(ANUBIS_HOME);
  const env = loadEnv(ANUBIS_HOME);
  const results = await runEval(config, env);
  return formatEvalResults(results);
}
