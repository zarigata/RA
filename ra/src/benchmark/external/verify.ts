// Deterministic verifiers for external benchmark suites (Wave 5).
// Every check runs the generated code against the suite's own asserts in a
// sandboxed subprocess with a hard timeout — no network, no LLM in the loop.

import { readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { ExternalTask } from "./tasks.ts";

export interface VerifyOutcome {
  passed: boolean;
  reason: string | null;
  /** Failure bucket for the taxonomy: syntax | wrong-logic | timeout | harness | none */
  failure: "none" | "syntax" | "wrong-logic" | "timeout" | "harness";
}

const PY = process.env.RA_BENCH_PYTHON ?? "python3";

/** Extract the first ```python fenced block from prose, else null. */
export function extractPythonCode(text: string): string | null {
  const m = text.match(/```(?:python|py)\s*\n([\s\S]*?)```/);
  if (m) return m[1];
  // Bare fenced block that looks like code — models do this often.
  const bare = text.match(/```\s*\n([\s\S]*?)```/);
  if (bare && /^\s*(def|class|from|import|@)/m.test(bare[1])) return bare[1];
  return null;
}

/** Default per-task verifier timeout. HumanEval/15's tests build multi-MB
 *  strings (inputs up to n≈1e6) — 60s is the empirically safe floor. */
export function defaultTimeoutMs(): number {
  return Number(process.env.RA_BENCH_TIMEOUT_MS ?? 60_000);
}

/** Run `python3 <file>` capturing bounded output; SIGKILL on timeout. */
export function runPython(
  file: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(PY, [file], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, opts.timeoutMs ?? defaultTimeoutMs());
    child.stdout.on("data", (d) => { stdout += d; if (stdout.length > 100_000) { killed = true; child.kill("SIGKILL"); } });
    child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 100_000) { killed = true; child.kill("SIGKILL"); } });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(0, 100_000), stderr: stderr.slice(0, 100_000), timedOut: killed });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: String(e), timedOut: false });
    });
  });
}

function outcomeFromResult(
  r: { code: number | null; stderr: string; timedOut: boolean },
): VerifyOutcome {
  if (r.timedOut) return { passed: false, reason: "timeout", failure: "timeout" };
  if (r.code === 0) return { passed: true, reason: null, failure: "none" };
  return {
    passed: false,
    reason: r.stderr.split("\n").filter(Boolean).slice(-4).join(" | ").slice(0, 300),
    failure: /SyntaxError|IndentationError|TabError|expected an indented block/.test(r.stderr) ? "syntax" : "wrong-logic",
  };
}

let verifierTmpN = 0;
function verifierTmpFile(tag: string): string {
  return join(tmpdir(), `ra-ext-${tag}-${process.pid}-${Date.now()}-${verifierTmpN++}.py`);
}

/**
 * HumanEval+ / MBPP+ core: candidate code + suite's own test harness in one
 * file, run in a subprocess. For HumanEval+ the candidate's solution.py is
 * appended AFTER the task prompt (the prompt ends mid-function — the model is
 * told to reproduce the signature — so the file alone may not be valid Python).
 */
export async function verifyPythonHarness(
  prelude: string,
  candidate: string,
  testCode: string,
): Promise<VerifyOutcome> {
  const file = verifierTmpFile("verify");
  // UTF-8 header: HE+ tasks embed non-ASCII docstrings (py3.9 needs the decl).
  writeFileSync(file, "# -*- coding: utf-8 -*-\n" + prelude + "\n" + candidate + "\n\n" + testCode + "\n");
  const r = await runPython(file);
  rmSync(file, { force: true });
  return outcomeFromResult(r);
}

/** Verify one task's post-run scratch dir. Falls back to fenced-block
 *  extraction from the agent transcript when solution.py is missing/empty —
 *  models sometimes answer in prose instead of using the write tool. */
export async function verifyExternalTask(
  task: ExternalTask,
  cwd: string,
  agentText?: string,
): Promise<VerifyOutcome> {
  const solutionPath = join(cwd, "solution.py");
  let solution = existsSyncFile(solutionPath) ? readFileSync(solutionPath, "utf-8") : "";
  if (!solution.trim()) {
    const extracted = agentText ? extractPythonCode(agentText) : null;
    if (extracted) solution = extracted;
    else return { passed: false, reason: "solution.py missing/empty", failure: "harness" };
  }

  if (task.raw?.heplus) {
    const { prompt, test, entry_point } = task.raw.heplus;
    return verifyPythonHarness(prompt, solution, test + `\n\ncheck(${entry_point})\n`);
  }
  if (task.raw?.mbpp) {
    const { test_imports, test_list } = task.raw.mbpp;
    return verifyPythonHarness("", solution, [...test_imports, ...test_list].join("\n"));
  }
  if (task.raw?.polyglot && task.suite === "polyglot-py") {
    // polyglotCheck handles the pristine-test run (needs the practice dir);
    // reaching here means the orchestrator didn't route it — explicit miss.
    return { passed: false, reason: "polyglot verify requires practiceDir", failure: "harness" };
  }
  return { passed: false, reason: "no verifier payload for task", failure: "harness" };
}

function existsSyncFile(p: string): boolean {
  // tiny local alias to keep the import list honest
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  return existsSync(p);
}

/**
 * Polyglot verifier: run the exercise's PRISTINE test (from the cache, never
 * the scratch copy the agent could have edited) against the agent's
 * implementation files in a throwaway dir.
 */
export async function polyglotCheck(
  practiceDir: string,
  exercise: string,
  scratch: string,
): Promise<VerifyOutcome> {
  const src = join(practiceDir, exercise);
  const testFile = readdirSync(src).find((f) => f.endsWith("_test.py"));
  if (!testFile) return { passed: false, reason: "no _test.py for exercise", failure: "harness" };
  const tmp = join(tmpdir(), `ra-polyglot-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  for (const f of readdirSync(scratch)) {
    if (!f.endsWith("_test.py")) cpSync(join(scratch, f), join(tmp, f));
  }
  cpSync(join(src, testFile), join(tmp, testFile));
  const r = await runPython(join(tmp, testFile), { timeoutMs: 30_000 });
  rmSync(tmp, { recursive: true, force: true });
  return outcomeFromResult(r);
}
