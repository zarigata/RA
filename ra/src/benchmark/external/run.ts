// External benchmark orchestrator (Wave 5): ra bench external <suite> --model M
// Maps each suite task onto the same runTaskAgent machinery `ra eval` uses
// (model pinned via tier/role overrides so results are attributable), verifies
// deterministically, and writes pass@1 + latency + cost into benchmarks/runs/.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadRaConfig } from "../../../../anubis/src/config.ts";
import { loadEnv } from "../../../../anubis/src/env.ts";
import { loadUsage, estimateCost, setPriceOverrides, priceOverridesFromConfig } from "../../../../anubis/src/cost.ts";
import { runTaskAgent } from "../../agent.ts";
import type { RaConfig } from "../../../../anubis/src/config.ts";
import type { ToolContext } from "../../tools/index.ts";
import { loadSuite, makeScratch, ensurePolyglot } from "./tasks.ts";
import { verifyExternalTask, polyglotCheck, type VerifyOutcome } from "./verify.ts";

export interface ExternalTaskReport {
  suite: string;
  id: string;
  model: string;
  passed: boolean;
  latencyMs: number;
  cost: number;
  failure: VerifyOutcome["failure"];
  reason: string | null;
  status: string;
  at: string;
}

export interface ExternalRunReport {
  suite: string;
  model: string;
  n: number;
  passed: number;
  passAt1: number;
  totalCost: number;
  totalMs: number;
  failures: Record<string, number>;
  tasks: ExternalTaskReport[];
  at: string;
}

/** Pin one model across every override surface, eval.ts-style. */
export function pinModel(config: RaConfig, model: string): RaConfig {
  const cfg: RaConfig = {
    ...config,
    model,
    small_model: model,
    agent: { ...config.agent, ptah: { model } },
    capability_router: { ...config.capability_router, enabled: false },
  } as RaConfig;
  (cfg as RaConfig & { tier_models?: Record<string, string> }).tier_models = {
    meta: model, light: model, heavy: model, code: model,
  };
  return cfg;
}

export interface ExternalBenchOpts {
  suite: string;
  model: string;
  limit?: number;
  /** Where task-file caches download (default benchmarks/.cache). */
  cacheDir?: string;
  /** Local task-file dir (tests / airgapped runs); skips downloading. */
  localDir?: string;
  /** Where reports go (default benchmarks/runs). */
  outDir?: string;
  /** Keep scratch dirs for debugging (default: clean up). */
  keepScratch?: boolean;
  /** Stop after cumulative cost exceeds this USD amount. */
  budgetUsd?: number;
}

export async function runExternalBench(opts: ExternalBenchOpts): Promise<ExternalRunReport> {
  const { ANUBIS_HOME } = await import("../../paths.ts");
  const benchRoot = opts.cacheDir ?? join(resolve(ANUBIS_HOME, "..", ".."), "benchmarks");
  const cacheDir = opts.cacheDir ?? join(benchRoot, ".cache");
  const outDir = opts.outDir ?? join(benchRoot, "runs");

  let tasks = await loadSuite(opts.suite, cacheDir, opts.localDir);
  if (opts.limit && opts.limit > 0) tasks = tasks.slice(0, opts.limit);
  if (!tasks.length) throw new Error(`suite '${opts.suite}' loaded zero tasks`);

  const practiceDir = opts.suite === "polyglot-py"
    ? (opts.localDir ?? ensurePolyglot(cacheDir))
    : undefined;

  const config = pinModel(loadRaConfig(ANUBIS_HOME), opts.model);
  // Provider pricing lives in ra.json (per-model cost overrides); without this
  // a custom provider's models price at $0 (only `ra status/cost` wired it).
  setPriceOverrides(priceOverridesFromConfig(loadRaConfig(ANUBIS_HOME)));
  const env = loadEnv(ANUBIS_HOME);

  const scratchRoot = join(tmpdir(), "ra-ext-bench");
  const reports: ExternalTaskReport[] = [];
  console.log(`external bench: ${opts.suite} · ${tasks.length} tasks · model ${opts.model}`);

  for (const task of tasks) {
    const scratch = makeScratch(task, scratchRoot, practiceDir);
    const before = loadUsage();
    const t0 = Date.now();
    let status = "ok";
    let agentText = "";
    try {
      const ctx: ToolContext = { cwd: scratch };
      const result = await runTaskAgent("ptah", task.prompt, config, ctx, env, 8);
      agentText = result.summary ?? "";
      status = result.status;
    } catch (e) {
      status = `error:${String(e instanceof Error ? e.message : e).slice(0, 120)}`;
    }
    const latencyMs = Date.now() - t0;
    const after = loadUsage();
    let cost = 0;
    for (const [m, u] of Object.entries(after)) {
      const prev = before[m];
      const inD = u.inputTokens - (prev?.inputTokens ?? 0);
      const outD = u.outputTokens - (prev?.outputTokens ?? 0);
      if (inD > 0 || outD > 0) cost += estimateCost(m, inD, outD);
    }
    let outcome: VerifyOutcome;
    try {
      outcome = practiceDir && task.suite === "polyglot-py"
        ? await polyglotCheck(practiceDir, task.id, scratch)
        : await verifyExternalTask(task, scratch, agentText);
    } catch (e) {
      outcome = { passed: false, reason: `verify crash: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`, failure: "harness" };
    }
    if (!opts.keepScratch) rmSync(scratch, { recursive: true, force: true });
    reports.push({
      suite: task.suite, id: task.id, model: opts.model,
      passed: outcome.passed, latencyMs, cost,
      failure: outcome.failure, reason: outcome.reason, status,
      at: new Date().toISOString(),
    });
    console.log(
      `  ${outcome.passed ? "✓" : "✗"} ${task.id} ${((latencyMs) / 1000).toFixed(1)}s $${cost.toFixed(4)}${outcome.passed ? "" : ` [${outcome.failure}] ${outcome.reason?.slice(0, 80) ?? ""}`}`,
    );
    if (opts.budgetUsd && reports.reduce((s, r) => s + r.cost, 0) > opts.budgetUsd) {
      console.log(`  budget cap $${opts.budgetUsd} reached — stopping`);
      break;
    }
  }

  const passed = reports.filter((r) => r.passed).length;
  const failures: Record<string, number> = {};
  for (const r of reports) if (!r.passed) failures[r.failure] = (failures[r.failure] ?? 0) + 1;
  const report: ExternalRunReport = {
    suite: opts.suite, model: opts.model, n: reports.length, passed,
    passAt1: reports.length ? passed / reports.length : 0,
    totalCost: reports.reduce((s, r) => s + r.cost, 0),
    totalMs: reports.reduce((s, r) => s + r.latencyMs, 0),
    failures, tasks: reports, at: new Date().toISOString(),
  };
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `external-${opts.suite}-${opts.model.replace(/[\/:]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`pass@1: ${passed}/${reports.length} (${(report.passAt1 * 100).toFixed(1)}%) · $${report.totalCost.toFixed(4)} · report: ${file}`);
  return report;
}
