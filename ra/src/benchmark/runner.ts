import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadRaConfig } from "../../../anubis/src/config.ts";
import { ANUBIS_HOME } from "../paths.ts";
import { runFullDevTask, ensureTaskArtifacts } from "../../../anubis/src/runner.ts";
import type { ToolContext } from "../tools/index.ts";

export const BENCHMARK_ROOT = join(homedir(), "Desktop", "RA-Tests");

export interface Scenario {
  name: string;
  prompt: string;
  cwd: string;
  tier?: string;
  success: Array<
    | { file_exists: string }
    | { file_contains: { path: string; text: string } }
  >;
}

export function parseScenarioYaml(raw: string): Scenario {
  // ponytail: minimal YAML parser for our fixed schema
  const lines = raw.split("\n");
  const s: Partial<Scenario> = { success: [] };
  let inSuccess = false;
  for (const line of lines) {
    if (line.startsWith("name:")) s.name = line.split(":").slice(1).join(":").trim();
    else if (line.startsWith("prompt:")) s.prompt = line.split(":").slice(1).join(":").trim().replace(/^"|"$/g, "");
    else if (line.startsWith("cwd:")) s.cwd = line.split(":").slice(1).join(":").trim().replace(/^~/, homedir());
    else if (line.startsWith("tier:")) s.tier = line.split(":")[1]?.trim();
    else if (line.trim() === "success:") inSuccess = true;
    else if (inSuccess && line.includes("file_exists:")) {
      s.success!.push({ file_exists: line.split("file_exists:")[1].trim() });
    } else if (inSuccess && line.includes("file_contains:")) {
      /* next lines handle path/text — simplified */
    } else if (inSuccess && line.includes("path:")) {
      const path = line.split("path:")[1].trim();
      const textLine = lines[lines.indexOf(line) + 1];
      const text = textLine?.split("text:")[1]?.trim().replace(/^"|"$/g, "") ?? "";
      s.success!.push({ file_contains: { path, text } });
    }
  }
  return s as Scenario;
}

export function benchmarkInit(): void {
  mkdirSync(BENCHMARK_ROOT, { recursive: true });
  mkdirSync(join(BENCHMARK_ROOT, "runs"), { recursive: true });
  for (const dir of ["cookie-website", "todo-app", "fix-bug", "smoke"]) {
    mkdirSync(join(BENCHMARK_ROOT, dir), { recursive: true });
  }
  console.log(`RA-Tests initialized at ${BENCHMARK_ROOT}`);
}

/** @deprecated prefer ensureTaskArtifacts in runner — kept for unit tests */
export function ensureBenchmarkArtifacts(ctx: ToolContext, prompt: string): void {
  ensureTaskArtifacts(ctx.cwd, prompt, []);
}

export async function runScenario(scenarioPath: string): Promise<boolean> {
  const raw = readFileSync(scenarioPath, "utf-8");
  const scenario = parseScenarioYaml(raw);
  const cwd = scenario.cwd.replace(/\$\{HOME\}/g, homedir());
  mkdirSync(cwd, { recursive: true });

  console.log(`\n▶ Benchmark: ${scenario.name}`);
  console.log(`  cwd: ${cwd}`);

  for (const check of scenario.success) {
    if ("file_exists" in check) rmSync(join(cwd, check.file_exists), { force: true });
    if ("file_contains" in check) rmSync(join(cwd, check.file_contains.path), { force: true });
  }

  // Seed recursive bug for fix-bug before the agent runs
  if (scenario.name === "fix-bug") {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(cwd, "hello.py"), "def hello():\n    hello()\n\nhello()\n");
  }

  loadRaConfig(ANUBIS_HOME);
  const ctx = { cwd };
  // Full-dev path = RA TUI boxes + .251 qwen plan + cloud/code model
  await runFullDevTask(scenario.prompt, {
    root: ANUBIS_HOME,
    stages: ["thoth", "ptah"],
    cwd,
  });
  // Acceptance examines only actual agent output; never manufacture artifacts.

  for (const check of scenario.success) {
    if ("file_exists" in check) {
      const p = join(cwd, check.file_exists);
      if (!existsSync(p)) {
        console.log(`  ✗ missing: ${check.file_exists}`);
        return false;
      }
      console.log(`  ✓ exists: ${check.file_exists}`);
    }
    if ("file_contains" in check) {
      const p = join(cwd, check.file_contains.path);
      if (!existsSync(p)) {
        console.log(`  ✗ missing: ${check.file_contains.path}`);
        return false;
      }
      const content = readFileSync(p, "utf-8");
      if (!content.toLowerCase().includes(check.file_contains.text.toLowerCase())) {
        console.log(`  ✗ ${check.file_contains.path} missing "${check.file_contains.text}"`);
        return false;
      }
      console.log(`  ✓ contains "${check.file_contains.text}"`);
    }
  }
  console.log(`  ✓ ${scenario.name} PASSED`);
  return true;
}

export async function benchmarkSmoke(): Promise<number> {
  benchmarkInit();
  const smokeDir = join(BENCHMARK_ROOT, "smoke");
  rmSync(join(smokeDir, "index.html"), { force: true });
  const ok = await runScenario(join(ANUBIS_HOME, "..", "benchmarks", "smoke", "scenario.yaml"));
  return ok ? 0 : 1;
}

export async function benchmarkRun(name: string): Promise<number> {
  console.log("RA benchmark");
  console.log("RA prefer small@251 → big@cloud  (gemma @local fallback)");
  benchmarkInit();
  const root = join(ANUBIS_HOME, "..", "benchmarks");
  if (name === "all") {
    const dirs = ["smoke", "cookie-website", "todo-app", "fix-bug"];
    let fail = 0;
    for (const d of dirs) {
      const p = join(root, d, "scenario.yaml");
      if (existsSync(p) && !(await runScenario(p))) fail++;
    }
    console.log(fail > 0 ? "RA benchmark FAIL" : "RA benchmark OK");
    return fail > 0 ? 1 : 0;
  }
  const p = join(root, name === "cookie" ? "cookie-website" : name, "scenario.yaml");
  if (!existsSync(p)) {
    console.error(`Unknown benchmark: ${name}`);
    return 1;
  }
  // Seed buggy file for fix-bug
  if (name === "fix-bug") {
    const cwd = join(BENCHMARK_ROOT, "fix-bug");
    mkdirSync(cwd, { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(cwd, "hello.py"), "def hello():\n    hello()\n\nhello()\n");
  }
  const ok = await runScenario(p);
  console.log(ok ? "RA benchmark OK" : "RA benchmark FAIL");
  return ok ? 0 : 1;
}
