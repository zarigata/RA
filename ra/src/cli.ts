#!/usr/bin/env bun
import { ANUBIS_HOME } from "./paths.ts";
import { startTui } from "./tui/app.ts";
import { loadRaConfig, ensureRaDirs } from "../../anubis/src/config.ts";
import { loadEnv } from "../../anubis/src/env.ts";
import { APP_NAME, renderSplash } from "../../anubis/src/tui.ts";
import { RA_VERSION } from "../../anubis/src/version.ts";
import { formatAssignments, resolveAll } from "../../anubis/src/router.ts";
import { renderRolesTable } from "../../anubis/src/tui.ts";
import { benchmarkInit, benchmarkSmoke, benchmarkRun } from "./benchmark/runner.ts";
import { runDoctor } from "./doctor.ts";
import { runFullDevTask } from "../../anubis/src/runner.ts";

process.env.RA_HOME = ANUBIS_HOME;
process.env.ANUBIS_HOME = ANUBIS_HOME;

const args = process.argv.slice(2);

function arg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

if (args.includes("--version") || args.includes("-v") || args[0] === "version") {
  console.log(`${APP_NAME} ${RA_VERSION}`);
  console.log("RA prefer small@251 → big@cloud  (gemma @local fallback)");
  process.exit(0);
}

if (args[0] === "splash") {
  console.log(renderSplash());
  process.exit(0);
}

if (args[0] === "home") {
  const { RA_GLOBAL } = await import("../../anubis/src/config.ts");
  const { formatRaHome } = await import("../../anubis/src/ra-home.ts");
  const { loadLastRun, formatLaneLine, formatIntentLine } = await import("../../anubis/src/last-run.ts");
  const last = loadLastRun();
  console.log(
    formatRaHome({
      anubis: ANUBIS_HOME,
      global: RA_GLOBAL,
      lastCwd: last?.cwd,
      lane: last?.timings?.length ? formatLaneLine(last) : null,
      intent: last?.intent ? formatIntentLine(last) : null,
    }),
  );
  process.exit(0);
}

if (args[0] === "palette") {
  const { PALETTE_COMMANDS } = await import("./commands/index.ts");
  console.log(
    ["RA palette", ...PALETTE_COMMANDS.map((cmd, i) => `  ${i + 1}. ${cmd}`)].join("\n"),
  );
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
  console.log(`${APP_NAME} — Relic Agent Terminal Coding Agent

Usage:
  ra                         Interactive TUI
  ra help                    This help
  ra version                 Print RA version
  ra splash                  Print RA TUI splash (branding check)
  ra home                    Show anubis + ~/.ra paths
  ra palette                 List TUI slash commands
  ra --task "..." [--quick] [--verify] [--json]  Full pipeline with RA TUI (--quick = 2 stages)
  ra run "..." [--quick] [--verify] [--json] [--cwd DIR]  Headless full-dev (no TUI, for CI/scripting)
  ra roles                   Show role assignments
  ra status                  Snapshot: profile, last run, usage
  ra last [--json]           Show last full-dev run
  ra history [--json]        Recent full-dev runs
  ra result                  One-line RA RESULT (bash greppable)
  ra lane                    One-line RA lane (thoth@251 → ptah@cloud)
  ra intent                  One-line RA intent (code|debug|plan|…)
  ra prefer                  One-line RA prefer (small@251 → big@cloud)
  ra files                   List files from last full-dev
  ra again [--quick] [--verify]  Re-run last full-dev task (same cwd)
  ra summary                 Last full-dev snapshot (status+result+timings)
  ra timings                 Per-stage host/model timings
  ra show                    Print last written file
  ra verify                  Re-check last full-dev artifacts (no LLM)
  ra env                     Show Ollama endpoints (keys masked)
  ra ping                    Latency check .251 / localhost / cloud
  ra which                   Which small host is active (@251 or @local)
  ra lanes                   Small@251 vs BIG@cloud routing map
  ra models                  Probe qwen/gemma on .251 + cloud BIG
  ra cost                    Usage / cost report
  ra init                    Mark cwd as RA project
  ra demo                    One-shot RA TUI full-dev (hello.py) + verify
  ra doctor                  Health check
  ra selfcheck               Splash + ping + lanes + models (no LLM)
  ra benchmark init|smoke|run <name|all>

Small models: 192.168.1.251 qwen3.8 (fallback: localhost gemma)
BIG models: Ollama Cloud glm-5.2

In TUI:
  /quick /again /plan /code /pipeline /help /simple on /status /files /show /result /lane /intent /prefer /summary /timings /verify /history /clear
  Ctrl+P                     Command palette
  /exit                      Quit`);
  process.exit(0);
}

ensureRaDirs();
loadEnv(ANUBIS_HOME);

if (args[0] === "doctor") {
  process.exit(await runDoctor());
}

if (args[0] === "selfcheck") {
  loadEnv(ANUBIS_HOME);
  const cfg = loadRaConfig(ANUBIS_HOME);
  const { formatSelfcheck } = await import("../../anubis/src/selfcheck.ts");
  const { ok, text } = await formatSelfcheck(cfg, process.env as Record<string, string | undefined>);
  console.log(text);
  process.exit(ok ? 0 : 1);
}

if (args[0] === "benchmark") {
  const sub = args[1];
  if (sub === "init") {
    benchmarkInit();
    process.exit(0);
  }
  if (sub === "smoke") process.exit(await benchmarkSmoke());
  if (sub === "run") process.exit(await benchmarkRun(args[2] ?? "smoke"));
  console.error("Usage: ra benchmark init|smoke|run <name>");
  process.exit(1);
}

if (args.includes("--roles") || args[0] === "roles") {
  const cfg = loadRaConfig(ANUBIS_HOME);
  console.log(renderRolesTable(formatAssignments(resolveAll(cfg))));
  console.log("RA prefer small@251 → big@cloud");
  process.exit(0);
}

if (args[0] === "status") {
  const { loadLastRun } = await import("../../anubis/src/last-run.ts");
  const { formatRaStatus } = await import("../../anubis/src/ra-status.ts");
  const { formatReport, buildReport, loadUsage } = await import("../../anubis/src/cost.ts");
  const cfg = loadRaConfig(ANUBIS_HOME);
  console.log(
    formatRaStatus({
      cwd: arg("--cwd") ?? process.cwd(),
      profile: cfg.profile,
      model: cfg.model,
      small: cfg.small_model,
      last: loadLastRun(),
      usage: formatReport(buildReport(loadUsage())),
    }),
  );
  process.exit(0);
}

if (args[0] === "last") {
  const { loadLastRun, formatLastRun, formatResultLine, formatLaneLine, formatIntentLine, formatPreferLine } = await import("../../anubis/src/last-run.ts");
  const run = loadLastRun();
  if (args.includes("--json")) {
    console.log(JSON.stringify(run, null, 2));
    process.exit(run ? 0 : 1);
  }
  console.log(formatLastRun(run));
  if (run) {
    console.log(formatResultLine(run));
    console.log(formatLaneLine(run));
    console.log(formatIntentLine(run));
    console.log(formatPreferLine(run));
  }
  process.exit(run ? 0 : 1);
}

if (args[0] === "history") {
  const { loadHistory, formatHistory } = await import("../../anubis/src/history.ts");
  const runs = loadHistory(12);
  if (args.includes("--json")) {
    console.log(JSON.stringify(runs, null, 2));
    process.exit(0);
  }
  console.log(`RA history\n${formatHistory(runs)}`);
  process.exit(0);
}

if (args[0] === "show") {
  const { loadLastRun, formatShow } = await import("../../anubis/src/last-run.ts");
  const out = formatShow(loadLastRun());
  console.log(out);
  process.exit(out.startsWith("RA show ") ? 0 : 1);
}

if (args[0] === "files") {
  const { loadLastRun, formatRaFiles } = await import("../../anubis/src/last-run.ts");
  const out = formatRaFiles(loadLastRun());
  console.log(out);
  process.exit(out.startsWith("RA files\n") || out.startsWith("RA files:") ? (out.includes("no files") ? 1 : 0) : 1);
}

if (args[0] === "result") {
  const { loadLastRun, formatResultLine, formatLaneLine, formatIntentLine, formatPreferLine } = await import("../../anubis/src/last-run.ts");
  const run = loadLastRun();
  if (!run) {
    console.error("No previous RA full-dev run.");
    process.exit(1);
  }
  console.log(formatResultLine(run));
  console.log(formatLaneLine(run));
  console.log(formatIntentLine(run));
  console.log(formatPreferLine(run));
  console.log("again: ra again --quick --verify");
  process.exit(0);
}

if (args[0] === "lane") {
  const { loadLastRun, formatLaneLine } = await import("../../anubis/src/last-run.ts");
  const run = loadLastRun();
  if (!run) {
    console.error("No previous RA full-dev run.");
    process.exit(1);
  }
  console.log(formatLaneLine(run));
  process.exit(0);
}

if (args[0] === "intent") {
  const { loadLastRun, formatIntentLine } = await import("../../anubis/src/last-run.ts");
  const out = formatIntentLine(loadLastRun());
  console.log(out);
  process.exit(out.startsWith("RA intent ") && !out.includes("no full-dev") ? 0 : 1);
}

if (args[0] === "prefer") {
  const { loadLastRun, formatPreferLine } = await import("../../anubis/src/last-run.ts");
  console.log(formatPreferLine(loadLastRun()));
  process.exit(0);
}

if (args[0] === "summary") {
  const { loadLastRun, formatRaSummary } = await import("../../anubis/src/last-run.ts");
  const out = formatRaSummary(loadLastRun());
  console.log(out);
  process.exit(out.includes("no full-dev") ? 1 : 0);
}

if (args[0] === "timings") {
  const { loadLastRun, formatRaTimings } = await import("../../anubis/src/last-run.ts");
  const out = formatRaTimings(loadLastRun());
  console.log(out);
  process.exit(out.includes("no stage") ? 1 : 0);
}

if (args[0] === "verify") {
  const { loadLastRun } = await import("../../anubis/src/last-run.ts");
  const { verifyLastRun } = await import("../../anubis/src/verify.ts");
  const { ok, lines } = await verifyLastRun(loadLastRun());
  console.log(lines.join("\n"));
  process.exit(ok ? 0 : 1);
}

if (args[0] === "env") {
  const { formatRaEnv } = await import("../../anubis/src/ra-env.ts");
  loadEnv(ANUBIS_HOME);
  console.log(formatRaEnv(process.env as Record<string, string | undefined>));
  process.exit(0);
}

if (args[0] === "ping") {
  const { pingAll, formatPings } = await import("../../anubis/src/ping.ts");
  loadEnv(ANUBIS_HOME);
  console.log(formatPings(await pingAll(process.env as Record<string, string | undefined>)));
  process.exit(0);
}

if (args[0] === "which") {
  const { formatRaWhich } = await import("../../anubis/src/which.ts");
  loadEnv(ANUBIS_HOME);
  console.log(await formatRaWhich(process.env as Record<string, string | undefined>));
  process.exit(0);
}

if (args[0] === "lanes") {
  const { formatLanes } = await import("../../anubis/src/lanes.ts");
  loadEnv(ANUBIS_HOME);
  const cfg = loadRaConfig(ANUBIS_HOME);
  console.log(formatLanes(cfg, process.env as Record<string, string | undefined>));
  process.exit(0);
}

if (args[0] === "models") {
  const { formatRaModels } = await import("../../anubis/src/models-list.ts");
  loadEnv(ANUBIS_HOME);
  const cfg = loadRaConfig(ANUBIS_HOME);
  console.log(await formatRaModels(cfg, process.env as Record<string, string | undefined>));
  process.exit(0);
}

if (args[0] === "cost") {
  const { formatReport, buildReport, loadUsage } = await import("../../anubis/src/cost.ts");
  const { loadLastRun, formatLaneLine, formatIntentLine, formatPreferLine } = await import("../../anubis/src/last-run.ts");
  const last = loadLastRun();
  console.log(`RA cost\n${formatReport(buildReport(loadUsage()))}`);
  console.log(formatPreferLine(last));
  if (last?.timings?.length) console.log(formatLaneLine(last));
  if (last?.intent) console.log(formatIntentLine(last));
  process.exit(0);
}

if (args[0] === "init") {
  const { writeFileSync, existsSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const cwd = arg("--project") ?? process.cwd();
  const dir = join(cwd, ".ra");
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, "project.json");
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      JSON.stringify(
        {
          name: "RA project",
          small: "ollama-lan/qwen3.8:latest",
          big: "ollama-cloud/glm-5.2",
          note: "Small models on 192.168.1.251; gemma on localhost as fallback",
        },
        null,
        2,
      ) + "\n",
    );
  }
  console.log(`${APP_NAME} init → ${marker}`);
  console.log(`RA prefer small@251 → big@cloud  (gemma @local fallback)`);
  console.log(`  ra --task "..." --quick --verify`);
  console.log(`  ra demo`);
  console.log(`  ./test.sh`);
  process.exit(0);
}

if (args[0] === "demo") {
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const cwd = mkdtempSync(join(tmpdir(), "ra-demo-"));
  console.log(`${APP_NAME} demo → ${cwd}`);
  const result = await runFullDevTask("write a hello world function in one file", {
    root: ANUBIS_HOME,
    stages: ["thoth", "ptah"],
    cwd,
  });
  if (!result.filesWritten.length) process.exit(1);
  const { loadLastRun } = await import("../../anubis/src/last-run.ts");
  const { verifyLastRun } = await import("../../anubis/src/verify.ts");
  const { ok, lines } = await verifyLastRun(loadLastRun());
  console.log("RA demo verify");
  console.log(lines.join("\n"));
  process.exit(ok ? 0 : 1);
}

if (args[0] === "again") {
  const { loadLastRun, formatLaneLine, formatIntentLine } = await import("../../anubis/src/last-run.ts");
  const last = loadLastRun();
  if (!last?.task) {
    console.error("RA again: no last run. Try: ra demo");
    process.exit(1);
  }
  const cwd = arg("--cwd") ?? last.cwd ?? process.cwd();
  const againQuick = args.includes("--quick");
  const againVerify = args.includes("--verify");
  console.log(`RA again → ${cwd}`);
  console.log(`task: ${last.task.slice(0, 120)}`);
  if (last.timings?.length) console.log(formatLaneLine(last));
  console.log(formatIntentLine(last));
  try {
    const result = await runFullDevTask(last.task, {
      root: ANUBIS_HOME,
      stages: againQuick ? ["thoth", "ptah"] : undefined,
      cwd,
    });
    if (!result.filesWritten.length && !result.summary) process.exit(1);
    if (againVerify) {
      const { verifyLastRun } = await import("../../anubis/src/verify.ts");
      const { ok, lines } = await verifyLastRun(loadLastRun());
      console.log("RA again verify");
      console.log(lines.join("\n"));
      process.exit(ok ? 0 : 1);
    }
    process.exit(0);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
}

if (args[0] === "run") {
  const runTask = args[1];
  if (!runTask) {
    console.error(`${APP_NAME} run: missing task. Usage: ra run "task" [--quick] [--verify] [--json] [--cwd DIR]`);
    process.exit(1);
  }
  const runQuick = args.includes("--quick");
  const runVerify = args.includes("--verify");
  const runJson = args.includes("--json");
  const runCwd = arg("--cwd") ?? process.cwd();
  try {
    const result = await runFullDevTask(runTask, {
      root: ANUBIS_HOME,
      stages: runQuick ? ["thoth", "ptah"] : undefined,
      cwd: runCwd,
      quiet: true,
    });
    if (!result.summary) process.exit(1);
    if (runJson) {
      const { loadLastRun } = await import("../../anubis/src/last-run.ts");
      console.log(JSON.stringify(loadLastRun(), null, 2));
    } else {
      const { loadLastRun, formatResultLine, formatLaneLine, formatIntentLine, formatPreferLine } = await import("../../anubis/src/last-run.ts");
      const last = loadLastRun();
      if (last) {
        console.log(formatResultLine(last));
        console.log(formatLaneLine(last));
        console.log(formatIntentLine(last));
        console.log(formatPreferLine(last));
      }
    }
    if (runVerify) {
      const { loadLastRun } = await import("../../anubis/src/last-run.ts");
      const { verifyLastRun } = await import("../../anubis/src/verify.ts");
      const { ok, lines } = await verifyLastRun(loadLastRun());
      console.log(lines.join("\n"));
      process.exit(ok ? 0 : 1);
    }
    process.exit(0);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
}

const task = arg("--task") ?? (args[0] === "task" ? args[1] : undefined);
const quick = args.includes("--quick");
const verify = args.includes("--verify");
const asJson = args.includes("--json");
if (task) {
  try {
    const stages = quick ? ["thoth", "ptah"] : undefined;
    const result = await runFullDevTask(task, {
      root: ANUBIS_HOME,
      stages,
      cwd: arg("--cwd") ?? process.cwd(),
    });
    if (!result.summary) process.exit(1);
    if (asJson) {
      const { loadLastRun } = await import("../../anubis/src/last-run.ts");
      console.log(JSON.stringify(loadLastRun(), null, 2));
    }
    if (verify) {
      const { loadLastRun } = await import("../../anubis/src/last-run.ts");
      const { verifyLastRun } = await import("../../anubis/src/verify.ts");
      const { ok, lines } = await verifyLastRun(loadLastRun());
      console.log(lines.join("\n"));
      process.exit(ok ? 0 : 1);
    }
    process.exit(0);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
}

const cwd = arg("--project") ?? process.cwd();
if (args.length > 0) {
  const first = args[0]!;
  if (!first.startsWith("-")) {
    console.error(`${APP_NAME}: unknown command '${first}'. Try: ra help`);
    process.exit(1);
  }
}
await startTui({ cwd });
