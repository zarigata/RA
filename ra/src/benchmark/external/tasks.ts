// External benchmark task sources (Wave 5): download-once + parse into a
// uniform ExternalTask shape. Cache lives under benchmarks/.cache/ (gitignored).
// No LLM calls here — pure data plumbing, so offline tests cover it with
// fixture files instead of the network.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const HUMANEVALPLUS_URL =
  "https://github.com/evalplus/humanevalplus_release/releases/download/v0.1.10/HumanEvalPlus-OriginFmt.jsonl.gz";
export const MBPPPLUS_URL =
  "https://github.com/evalplus/mbppplus_release/releases/download/v0.1.6/MbppPlus.jsonl.gz";
export const POLYGLOT_REPO = "https://github.com/Aider-AI/polyglot-benchmark";

/** Uniform task shape; `raw` carries the suite payload the verifier needs. */
export interface ExternalTask {
  suite: string;
  id: string;
  /** Prompt handed to the agent. */
  prompt: string;
  /** Files to seed into the scratch dir before the run (path → content). */
  files?: Record<string, string>;
  /** Suite-specific verifier payload (heplus/mbpp asserts, polyglot stub name). */
  raw?: {
    heplus?: { prompt: string; test: string; entry_point: string };
    mbpp?: { test_imports: string[]; test_list: string[] };
    polyglot?: { stubName: string };
  };
}

/** Download once into the cache dir; returns the local path. */
export async function downloadCached(url: string, cacheDir: string, file: string): Promise<string> {
  const p = join(cacheDir, file);
  if (!existsSync(p)) {
    mkdirSync(cacheDir, { recursive: true });
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
    writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  return p;
}

function readJsonlGz(path: string): unknown[] {
  const raw = gunzipSync(readFileSync(path)).toString("utf-8");
  return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// --- HumanEval+ (OriginFmt: task_id, prompt, canonical_solution, entry_point,
// test — HumanEval's 164 tasks with EvalPlus's extra asserts) ---

interface HeplusRaw { task_id: string; prompt: string; entry_point: string; test: string }

export function parseHumanevalPlus(rawTasks: HeplusRaw[]): ExternalTask[] {
  return rawTasks.map((t) => ({
    suite: "humanevalplus",
    id: t.task_id,
    prompt:
      `Complete the following Python function. Save the complete function in solution.py ` +
      `(valid Python defining \`${t.entry_point}\`, including any needed imports — the signature/docstring below must be reproduced). ` +
      `Do not run the code; just write the file.\n\n${t.prompt}`,
    files: { "solution.py": "" },
    raw: { heplus: { prompt: t.prompt, test: t.test, entry_point: t.entry_point } },
  }));
}

// --- MBPP+ (task_id, prompt, test_imports, test_list) ---

interface MbppRaw { task_id: number; prompt: string; test_imports: string[]; test_list: string[] }

export function parseMbppPlus(rawTasks: MbppRaw[]): ExternalTask[] {
  return rawTasks.map((t) => ({
    suite: "mbppplus",
    id: String(t.task_id),
    prompt:
      `${t.prompt} Write the complete Python solution in solution.py (define the function the asserts call, including any needed imports). ` +
      `The solution must satisfy:\n` +
      t.test_list.map((a) => `> ${a}`).join("\n"),
    files: { "solution.py": "" },
    raw: { mbpp: { test_imports: t.test_imports, test_list: t.test_list } },
  }));
}

/** Clone (sparse, python track only) or reuse the polyglot benchmark cache. */
export function ensurePolyglot(cacheDir: string): string {
  const p = join(cacheDir, "polyglot-benchmark");
  if (!existsSync(join(p, "python", "exercises", "practice"))) {
    mkdirSync(cacheDir, { recursive: true });
    execFileSync(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", POLYGLOT_REPO, p],
      { stdio: "pipe" },
    );
    execFileSync("git", ["-C", p, "sparse-checkout", "set", "python/exercises/practice"], { stdio: "pipe" });
  }
  return join(p, "python", "exercises", "practice");
}

/**
 * One polyglot exercise per task: instructions (.docs/instructions.md +
 * optional .docs/instructions.append.md, mirroring Aider's composition rule)
 * as the prompt, the stub implementation seeded, pytest as the verifier.
 * .meta/ (reference solution) is deliberately never seeded into scratch dirs.
 */
export function loadPolyglotTasks(practiceDir: string): ExternalTask[] {
  const tasks: ExternalTask[] = [];
  for (const name of readdirSync(practiceDir).sort()) {
    const dir = join(practiceDir, name);
    const instr = join(dir, ".docs", "instructions.md");
    if (!existsSync(instr)) continue;
    let prompt = readFileSync(instr, "utf-8");
    const extra = join(dir, ".docs", "instructions.append.md");
    if (existsSync(extra)) prompt += "\n\n" + readFileSync(extra, "utf-8");
    const py = readdirSync(dir).find((f) => f.endsWith(".py") && !f.endsWith("_test.py"));
    if (!py) continue;
    tasks.push({
      suite: "polyglot-py",
      id: name,
      prompt:
        `Implement the ${name} exercise by replacing the stub in ${py} (keep the same module name and function signatures the tests import). ` +
        `The file ${py.replace(/\.py$/, "")}_test.py in this directory contains the unit tests — read it to understand the expected behavior, but do NOT modify it.\n\n${prompt}`,
      files: { [py]: readFileSync(join(dir, py), "utf-8") },
      raw: { polyglot: { stubName: py } },
    });
  }
  return tasks;
}

/**
 * Materialize a fresh scratch dir for one task. For polyglot the exercise's
 * test file is copied in (the agent is told not to modify it; the verifier
 * re-runs the pristine test, so tampering only fools itself). .meta/ is never
 * seeded. Existing dirs get a numeric suffix instead of being clobbered.
 */
export function makeScratch(task: ExternalTask, scratchRoot: string, polyglotPractice?: string): string {
  const safe = task.id.replace(/[^\w.-]/g, "_");
  let dir = join(scratchRoot, task.suite, safe);
  let n = 0;
  while (existsSync(dir)) dir = `${join(scratchRoot, task.suite, safe)}-${++n}`;
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of Object.entries(task.files ?? {})) {
    writeFileSync(join(dir, path), content);
  }
  if (task.suite === "polyglot-py" && polyglotPractice) {
    const src = join(polyglotPractice, task.id);
    for (const f of readdirSync(src)) {
      if (f.endsWith("_test.py")) cpSync(join(src, f), join(dir, f));
    }
  }
  return dir;
}

/** Load the task list for a suite (downloads on first use). */
export async function loadSuite(suite: string, cacheDir: string, localDir?: string): Promise<ExternalTask[]> {
  if (localDir) return loadSuiteFromDir(suite, localDir);
  switch (suite) {
    case "humanevalplus": {
      const p = await downloadCached(HUMANEVALPLUS_URL, cacheDir, "HumanEvalPlus-OriginFmt.jsonl.gz");
      return parseHumanevalPlus(readJsonlGz(p) as HeplusRaw[]);
    }
    case "mbppplus": {
      const p = await downloadCached(MBPPPLUS_URL, cacheDir, "MbppPlus.jsonl.gz");
      return parseMbppPlus(readJsonlGz(p) as MbppRaw[]);
    }
    case "polyglot-py":
      return loadPolyglotTasks(ensurePolyglot(cacheDir));
    default:
      throw new Error(`unknown suite '${suite}' (humanevalplus | mbppplus | polyglot-py)`);
  }
}

/** Local fixture dir mode: <suite>-shaped files, no network — used by tests. */
export function loadSuiteFromDir(suite: string, dir: string): ExternalTask[] {
  switch (suite) {
    case "humanevalplus":
      return parseHumanevalPlus(
        readFileSync(join(dir, "humanevalplus.jsonl"), "utf-8")
          .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)),
      );
    case "mbppplus":
      return parseMbppPlus(JSON.parse(readFileSync(join(dir, "mbppplus.json"), "utf-8")));
    case "polyglot-py":
      return loadPolyglotTasks(dir);
    default:
      throw new Error(`unknown suite '${suite}'`);
  }
}
