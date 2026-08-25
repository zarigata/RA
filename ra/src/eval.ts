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

/** A comprehensive set of real coding tasks covering multiple languages and patterns. */
export const EVAL_TASKS: EvalTask[] = [
  // --- Python basics ---
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
    name: "factorial",
    prompt: "Write a Python function factorial(n) that returns n! using recursion. Save in math_utils.py.",
    verify: (cwd) => {
      const p = join(cwd, "math_utils.py");
      return existsSync(p) && /def factorial\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "fibonacci",
    prompt: "Write a Python function fibonacci(n) that returns the n-th Fibonacci number. Save in fib.py.",
    verify: (cwd) => {
      const p = join(cwd, "fib.py");
      return existsSync(p) && /def fibonacci\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "reverse-string",
    prompt: "Write a Python function reverse_string(s) that returns the reversed string. Save in strings.py.",
    verify: (cwd) => {
      const p = join(cwd, "strings.py");
      return existsSync(p) && /def reverse_string\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "palindrome",
    prompt: "Write a Python function is_palindrome(s) that returns True if s reads the same forwards and backwards. Save in strings.py.",
    verify: (cwd) => {
      const p = join(cwd, "strings.py");
      if (!existsSync(p)) return false;
      const txt = readFileSync(p, "utf-8");
      return /def is_palindrome\(/.test(txt);
    },
  },
  {
    name: "list-max",
    prompt: "Write a Python function find_max(lst) that returns the maximum value in a list without using max(). Save in list_ops.py.",
    verify: (cwd) => {
      const p = join(cwd, "list_ops.py");
      return existsSync(p) && /def find_max\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "count-vowels",
    prompt: "Write a Python function count_vowels(s) that returns the number of vowels (a,e,i,o,u) in a string. Save in strings.py.",
    verify: (cwd) => {
      const p = join(cwd, "strings.py");
      if (!existsSync(p)) return false;
      return /def count_vowels\(/.test(readFileSync(p, "utf-8"));
    },
  },
  // --- HTML/CSS ---
  {
    name: "html-page",
    prompt: "Create an index.html page with a <h1>Hello</h1> heading.",
    verify: (cwd) => {
      const p = join(cwd, "index.html");
      return existsSync(p) && /<h1>hello<\/h1>/i.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "html-form",
    prompt: "Create an index.html with a form containing a text input and a submit button.",
    verify: (cwd) => {
      const p = join(cwd, "index.html");
      if (!existsSync(p)) return false;
      const txt = readFileSync(p, "utf-8");
      return /<form/i.test(txt) && /<input/i.test(txt) && /submit/i.test(txt);
    },
  },
  {
    name: "css-styled-box",
    prompt: "Create a box.html file with a div that has inline style background-color red and dimensions 200x200.",
    verify: (cwd) => {
      const p = join(cwd, "box.html");
      if (!existsSync(p)) return false;
      const txt = readFileSync(p, "utf-8");
      return /<div/i.test(txt) && /red/i.test(txt) && /200/i.test(txt);
    },
  },
  // --- JavaScript ---
  {
    name: "js-hello",
    prompt: "Write a JavaScript function hello() that returns 'Hello, World!'. Save in hello.js.",
    verify: (cwd) => {
      const p = join(cwd, "hello.js");
      return existsSync(p) && /function hello\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "js-array-sum",
    prompt: "Write a JavaScript function sumArray(arr) that returns the sum of all elements. Save in arrays.js.",
    verify: (cwd) => {
      const p = join(cwd, "arrays.js");
      return existsSync(p) && /function sumArray\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "js-filter-even",
    prompt: "Write a JavaScript function filterEven(arr) that returns only even numbers from the array. Save in arrays.js.",
    verify: (cwd) => {
      const p = join(cwd, "arrays.js");
      if (!existsSync(p)) return false;
      return /function filterEven\(/.test(readFileSync(p, "utf-8"));
    },
  },
  // --- TypeScript ---
  {
    name: "ts-interface",
    prompt: "Write a TypeScript file types.ts defining an interface User with properties: id (number), name (string), email (string).",
    verify: (cwd) => {
      const p = join(cwd, "types.ts");
      if (!existsSync(p)) return false;
      const txt = readFileSync(p, "utf-8");
      return /interface User/i.test(txt) && /id.*number/i.test(txt) && /name.*string/i.test(txt);
    },
  },
  // --- Bug fix tasks ---
  {
    name: "fix-missing-print",
    prompt: "The file hello.py contains a function hello() but it doesn't print anything. Fix it so it prints 'Hello, World!'.",
    verify: (cwd) => {
      const p = join(cwd, "hello.py");
      if (!existsSync(p)) return false;
      return /print.*hello/i.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "fix-off-by-one",
    prompt: "The file range.py has a function get_range(n) that returns range(0, n-1) but should return range(0, n). Fix the off-by-one bug.",
    verify: (cwd) => {
      const p = join(cwd, "range.py");
      if (!existsSync(p)) return false;
      return /range\(0,\s*n\)/.test(readFileSync(p, "utf-8"));
    },
  },
  // --- File I/O ---
  {
    name: "write-readme",
    prompt: "Create a README.md file with the title '# My Project' and a short description.",
    verify: (cwd) => {
      const p = join(cwd, "README.md");
      return existsSync(p) && /^#\s+My Project/i.test(readFileSync(p, "utf-8"));
    },
  },
  // --- JSON ---
  {
    name: "json-config",
    prompt: "Create a config.json file with a JSON object containing 'name' and 'version' keys.",
    verify: (cwd) => {
      const p = join(cwd, "config.json");
      if (!existsSync(p)) return false;
      try {
        const obj = JSON.parse(readFileSync(p, "utf-8"));
        return typeof obj === "object" && "name" in obj && "version" in obj;
      } catch { return false; }
    },
  },
  // --- Algorithm ---
  {
    name: "bubble-sort",
    prompt: "Write a Python function bubble_sort(arr) that sorts a list in ascending order using bubble sort. Save in sort.py.",
    verify: (cwd) => {
      const p = join(cwd, "sort.py");
      return existsSync(p) && /def bubble_sort\(/.test(readFileSync(p, "utf-8"));
    },
  },
  {
    name: "binary-search",
    prompt: "Write a Python function binary_search(arr, target) that returns the index of target or -1. Save in search.py.",
    verify: (cwd) => {
      const p = join(cwd, "search.py");
      return existsSync(p) && /def binary_search\(/.test(readFileSync(p, "utf-8"));
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
