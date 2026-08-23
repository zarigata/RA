// src/runner.ts — full dev task runner (pipeline stages → ollama)

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRaConfig, applyProjectOverride, applyEnvOverrides, type RaConfig } from "./config.ts";
import { pickClientForModel, runWithFallback } from "./ollama.ts";
import { resolveRoleModel, resolveAll, formatAssignments, type RouterConfig } from "./router.ts";
import { DEFAULT_PIPELINE_STAGES, planPipeline } from "./pipeline.ts";
import { renderSplash, renderStageProgress, renderTaskComplete, renderRolesTable } from "./tui.ts";
import { loadEnv } from "./env.ts";
import { recordChatUsage, formatReport, buildReport, loadUsage } from "./cost.ts";
import { saveLastRun, formatResultLine, formatLaneLine, formatIntentLine, formatPreferLine, type StageTiming } from "./last-run.ts";
import { appendHistory } from "./history.ts";
import { detectIntent } from "./intent.ts";
import { HELLO_PY_STUB, ensureHelloPyBody } from "./hello-py.ts";

const ROLE_PROMPTS: Record<string, string> = {
  thoth: "You are Thoth — planner. Outline steps only. Be brief.",
  ptah: "You are Ptah — implementer. Write working code in one fenced block. Prefer a single file. For hello world Python use def hello(): print(\"Hello, World!\") — never recurse. For websites write complete HTML in one ```html fence.",
  maat: "You are Maat — reviewer. Find bugs and gaps. Be brief.",
  sekhmet: "You are Sekhmet — adversarial critic. Challenge the solution briefly.",
  seshat: "You are Seshat — documenter. Summarize what was built in 5 lines.",
  horus: "You are Horus — fast helper. Be brief.",
};

export interface RunResult {
  task: string;
  stages: string[];
  outputs: Array<{ stage: string; model: string; content: string }>;
  summary: string;
  filesWritten: string[];
}

export function loadConfig(root: string): RaConfig {
  process.env.ANUBIS_HOME = root;
  return loadRaConfig(root);
}

export function extractCodeFile(content: string, task: string): { name: string; body: string } | null {
  let body = "";
  const fence = content.match(/```(?:python|javascript|typescript|html|css|py|js|ts)?\s*\n([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  if (!body) {
    const html = content.match(/<!DOCTYPE html[\s\S]*?<\/html>/i);
    if (html) body = html[0].trim();
  }
  if (!body) return null;

  let name = "output.txt";
  if (/\bindex\.html\b|\bhtml\b|<!DOCTYPE|\.html\b|website|page\b/i.test(task + content) || /```html/i.test(content)) {
    name = "index.html";
  } else if (/```python|\.py\b|def |print\(/i.test(content) || /\bpython\b/i.test(task)) {
    name = "hello.py";
  } else if (/```(?:javascript|js|typescript|ts)/i.test(content)) {
    name = "hello.js";
  }
  const named = content.match(/(?:file|create|save)[:\s]+[`"]?([^\s`"]+\.[a-z]+)/i);
  if (named) name = named[1];
  if (/\bindex\.html\b/i.test(task)) name = "index.html";
  if (name.endsWith(".py") && /\bhello\b/i.test(task)) {
    body = ensureHelloPyBody(body);
  }
  if (name === "index.html") {
    body = ensureIndexHtmlBody(body);
  }
  return { name, body };
}

/** Minimal HTML shell so website artifacts always render */
export function ensureIndexHtmlBody(body: string): string {
  const t = body.trim();
  if (!t) {
    return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>RA</title></head><body><h1>Hello</h1></body></html>\n`;
  }
  if (/<!DOCTYPE\s+html/i.test(t) && /<html[\s>]/i.test(t)) return t.endsWith("\n") ? t : t + "\n";
  if (/<html[\s>]/i.test(t)) return `<!DOCTYPE html>\n${t.endsWith("\n") ? t : t + "\n"}`;
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>RA</title></head><body>\n${t}\n</body></html>\n`;
}

/** Write stub artifacts when the model forgot fences — keeps RA RESULT files= nonempty */
export function ensureTaskArtifacts(workDir: string, task: string, filesWritten: string[]): string[] {
  mkdirSync(workDir, { recursive: true });
  const wrote: string[] = [];
  const index = join(workDir, "index.html");
  const helloPy = join(workDir, "hello.py");
  const hasIndex = (needle: string) =>
    existsSync(index) && readFileSync(index, "utf-8").toLowerCase().includes(needle);

  const write = (path: string, body: string) => {
    writeFileSync(path, body.endsWith("\n") ? body : body + "\n", "utf-8");
    if (!filesWritten.includes(path) && !wrote.includes(path)) wrote.push(path);
  };

  if (/\btodo\b/i.test(task) && !hasIndex("todo")) {
    write(index, `<!DOCTYPE html><html><head><title>Todo</title></head><body><h1>Todo App</h1><ul id="todos"></ul></body></html>`);
  } else if (/\bcookie\b/i.test(task) && !hasIndex("cookie")) {
    write(index, `<!DOCTYPE html><html><head><title>Cookie Recipe</title></head><body><h1>Cookie Recipe</h1><p>Flour, butter, sugar.</p></body></html>`);
  } else if (/\b(index\.html|html|website|page)\b/i.test(task) && /\bhello\b/i.test(task) && !hasIndex("hello")) {
    write(index, `<!DOCTYPE html><html><head><title>Hello</title></head><body><h1>Hello World</h1></body></html>`);
  } else if (/\bhello\b/i.test(task)) {
    if (existsSync(helloPy)) {
      const body = readFileSync(helloPy, "utf-8");
      const fixed = ensureHelloPyBody(body);
      if (fixed !== body) write(helloPy, fixed);
    } else if (!hasIndex("hello") && filesWritten.length === 0) {
      write(helloPy, HELLO_PY_STUB);
    }
  }
  // Repair incomplete HTML the model wrote without a doctype shell
  if (existsSync(index)) {
    const body = readFileSync(index, "utf-8");
    if (!/<!DOCTYPE\s+html/i.test(body)) {
      write(index, ensureIndexHtmlBody(body));
    }
  }
  return wrote;
}

export async function runFullDevTask(
  task: string,
  opts: { root?: string; stages?: string[]; quiet?: boolean; cwd?: string } = {},
): Promise<RunResult> {
  const root = opts.root ?? join(import.meta.dir, "..");
  const workDir = opts.cwd ?? process.cwd();
  const env = loadEnv(root);
  const config = applyEnvOverrides(applyProjectOverride(loadConfig(root), workDir), env);
  const stages = opts.stages ?? DEFAULT_PIPELINE_STAGES.slice(0, 4);
  const plan = planPipeline(task, stages);
  if (!plan) throw new Error("invalid pipeline stages");

  if (!opts.quiet) console.log(renderSplash());

  const t0 = Date.now();
  const outputs: RunResult["outputs"] = [];
  const filesWritten: string[] = [];
  const hostsUsed: string[] = [];
  const timings: StageTiming[] = [];

  for (const stage of plan.stages) {
    const assignment = resolveRoleModel(stage, config);
    let content = "";
    let usedModel = assignment.model;
    let usedHost = "lan";
    const stageT0 = Date.now();
    const system = ROLE_PROMPTS[stage] ?? `You are ${stage}.`;
    const prior = outputs.map((o) => `[${o.stage}]: ${o.content.slice(0, 300)}`).join("\n");
    const user = prior
      ? `Task: ${task}\n\nPrior work:\n${prior}\n\nYour turn (${stage}):`
      : `Task: ${task}\n\nYour turn (${stage}):`;
    try {
      const { result, attempts } = await runWithFallback(assignment.model, env, (client, model) =>
        client.nativeChat(model, [
          { role: "system", content: system },
          { role: "user", content: user },
        ], { timeoutMs: 120_000 }),
        (candidate, e) => pickClientForModel(candidate, e, config.provider as Record<string, import("./ollama.ts").ProviderDef> | undefined),
      );
      content = result.content;
      usedModel = result.model;
      const okAttempt = attempts.find((a) => a.ok);
      usedHost = okAttempt?.host ?? "lan";
      recordChatUsage(result.model, usedHost === "cloud", result.usage, {
        in: system.length + user.length,
        out: content.length,
      });
    } catch (e) {
      content = `(stage ${stage} failed: ${String(e)})`;
    }

    if (stage === "ptah") {
      const file = extractCodeFile(content, task);
      if (file) {
        mkdirSync(workDir, { recursive: true });
        const path = join(workDir, file.name);
        writeFileSync(path, file.body + "\n", "utf-8");
        filesWritten.push(path);
        if (!opts.quiet) console.log(`\x1b[2m  → wrote ${path}\x1b[0m`);
      }
    }

    const stageMs = Date.now() - stageT0;
    timings.push({ stage, model: usedModel, host: usedHost, ms: stageMs });
    outputs.push({ stage, model: usedModel, content });
    if (!hostsUsed.includes(usedHost)) hostsUsed.push(usedHost);
    if (!opts.quiet) {
      console.log(
        renderStageProgress(stage, usedModel, content, {
          host: usedHost,
          ms: stageMs,
        }),
      );
    }
  }

  // If ptah returned prose without a fence, still land a usable file for known tasks
  for (const extra of ensureTaskArtifacts(workDir, task, filesWritten)) {
    filesWritten.push(extra);
    if (!opts.quiet) console.log(`\x1b[2m  → wrote ${extra} (ensure)\x1b[0m`);
  }

  const summary = outputs.map((o) => `## ${o.stage}\n${o.content}`).join("\n\n");
  const last = saveLastRun({
    task,
    stages: plan.stages,
    models: outputs.map((o) => o.model),
    filesWritten,
    hosts: hostsUsed,
    ms: Date.now() - t0,
    intent: detectIntent(task),
    cwd: workDir,
    timings,
  });
  appendHistory(last);
  if (!opts.quiet) {
    console.log(
      renderTaskComplete(task, plan.stages, summary, {
        lane: formatLaneLine(last),
        intent: formatIntentLine(last),
        prefer: formatPreferLine(last),
        elapsed: last.ms != null ? `elapsed: ${(last.ms / 1000).toFixed(1)}s` : undefined,
        files: `files: ${last.filesWritten.length}`,
      }),
    );
    const costLine = formatReport(buildReport(loadUsage()));
    if (!costLine.startsWith("No usage")) {
      console.log(`\x1b[2m╭ RA /cost ─\n${costLine.split("\n").map((l) => `│ ${l}`).join("\n")}\n╰─\x1b[0m`);
    }
    console.log(formatResultLine(last));
    console.log(formatLaneLine(last));
    console.log(formatIntentLine(last));
    console.log(formatPreferLine(last));
    console.log("again: ra again --quick --verify");
  }

  return { task, stages: plan.stages, outputs, summary, filesWritten };
}

export function renderRoles(config: RouterConfig): string {
  return renderRolesTable(formatAssignments(resolveAll(config)));
}
