import { formatAssignments, resolveAll, resolveRoleModel } from "../../../anubis/src/router.ts";
import { formatReport, buildReport, loadUsage } from "../../../anubis/src/cost.ts";
import { scanSubnet, formatDiscovery } from "../../../anubis/src/lan.ts";
import { buildAggregatePrompt, DEFAULT_MOA_CONFIG } from "../../../anubis/src/aggregator.ts";
import { DEFAULT_PIPELINE_STAGES, planPipeline } from "../../../anubis/src/pipeline.ts";
import { runTaskAgent } from "../agent.ts";
import { runFullDevTask } from "../../../anubis/src/runner.ts";
import type { RaConfig } from "../../../anubis/src/config.ts";
import type { Session } from "../server/session.ts";
import type { PluginHost } from "../plugins/host.ts";
import type { ToolContext } from "../tools/index.ts";
import { classifyTier, tierModel } from "../tier.ts";
import { loadEnv } from "../../../anubis/src/env.ts";
import { ANUBIS_HOME } from "../paths.ts";
import { listDir } from "../tools/index.ts";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  /** Role that runs the command (default: anubis). */
  agent?: string;
}

const CUSTOM_COMMANDS_DIR = join(ANUBIS_HOME, ".anubis", "commands");

/** Search order for custom commands: project, user, legacy repo dir. */
export function customCommandDirs(cwd?: string): string[] {
  return [
    join(cwd ?? process.cwd(), ".ra", "commands"),
    join(homedir(), ".ra", "commands"),
    CUSTOM_COMMANDS_DIR,
  ];
}

/** Load custom slash commands from Markdown files with frontmatter. */
export function loadCustomCommands(dirs: string | string[] = customCommandDirs()): CustomCommand[] {
  const list = Array.isArray(dirs) ? dirs : [dirs];
  const out: CustomCommand[] = [];
  const seen = new Set<string>();
  for (const dir of list) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      try {
        const raw = readFileSync(join(dir, f), "utf-8");
        const fm = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!fm) continue;
        const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
        const description = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
        const agent = fm[1].match(/^agent:\s*(.+)$/m)?.[1]?.trim();
        const prompt = fm[2].trim();
        if (name && prompt && !seen.has(name)) {
          seen.add(name);
          out.push({ name, description, prompt, agent });
        }
      } catch {
        /* skip malformed command file */
      }
    }
  }
  return out;
}

export interface CommandContext {
  config: RaConfig;
  session: Session;
  plugins: PluginHost;
  ctx: ToolContext;
  reply: (text: string) => void;
}

const HELP_SIMPLE = `RA Simple Mode — commands:
  /plan <task>   Plan your project
  /code <task>   Build it
  /quick <task>  Full-dev (plan+code) with RA TUI
  /help          This help
  /simple off    Pro mode`;

const HELP_PRO = `RA — commands:
  Build        /plan /code /quick /pipeline /again
  Review       /review /critique /docs /moa /tree
  Teams        /agents /swarm help /swarm list
  Safety       /sandbox status /sandbox help
  Project      /ls /files /show /todos /verify
  Session      /status /history /sessions /replay /clear
  Models       /roles /models /env /ping /doctor /cost
  Results      /result /summary /timings /lane /intent /prefer
  Connection   /connect /home /which /lanes /selfcheck /lan-scan
  Interface    /simple on /simple off /palette /help /exit
  Ctrl+P       Command palette
  Esc          Cancel the current model request`;


export async function dispatchCommand(raw: string, c: CommandContext): Promise<boolean> {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return false;

  const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  const slashCmd = cmd.toLowerCase();

  await c.plugins.emit("tui.command.execute", { command: trimmed }, { handled: false });

  switch (slashCmd) {
    case "help":
      c.reply(c.session.simpleMode ? HELP_SIMPLE : HELP_PRO);
      return true;
    case "palette": {
      c.reply(
        `RA palette\n${PALETTE_COMMANDS.map((cmd, i) => `  ${i + 1}. ${cmd}`).join("\n")}`,
      );
      return true;
    }
    case "sandbox": {
      const { sandboxCommand } = await import("./sandbox.ts");
      const { commandWords } = await import("./teams.ts");
      const { withAgentRun } = await import("../execution.ts");
      const result = await withAgentRun({ limits: c.config.agent_limits }, () => sandboxCommand(commandWords(arg), c.ctx.cwd, c.config));
      c.reply(result.text);
      return true;
    }
    case "version": {
      const { RA_VERSION } = await import("../../../anubis/src/version.ts");
      c.reply(`RA ${RA_VERSION}`);
      return true;
    }
    case "ls": {
      const dir = arg || ".";
      c.reply(`RA ls ${dir}\n${listDir(c.ctx, dir)}`);
      return true;
    }
    case "env": {
      const { formatRaEnv } = await import("../../../anubis/src/ra-env.ts");
      loadEnv(ANUBIS_HOME);
      c.reply(formatRaEnv(process.env as Record<string, string | undefined>));
      return true;
    }
    case "ping": {
      const { pingAll, formatPings } = await import("../../../anubis/src/ping.ts");
      loadEnv(ANUBIS_HOME);
      c.reply(formatPings(await pingAll(process.env as Record<string, string | undefined>)));
      return true;
    }
    case "which": {
      const { formatRaWhich } = await import("../../../anubis/src/which.ts");
      loadEnv(ANUBIS_HOME);
      c.reply(await formatRaWhich(process.env as Record<string, string | undefined>));
      return true;
    }
    case "lanes": {
      const { formatLanes } = await import("../../../anubis/src/lanes.ts");
      loadEnv(ANUBIS_HOME);
      c.reply(formatLanes(c.config, process.env as Record<string, string | undefined>));
      return true;
    }
    case "home": {
      const { RA_GLOBAL } = await import("../../../anubis/src/config.ts");
      const { formatRaHome } = await import("../../../anubis/src/ra-home.ts");
      const { loadLastRun, formatLaneLine, formatIntentLine } = await import("../../../anubis/src/last-run.ts");
      const last = loadLastRun();
      c.reply(
        formatRaHome({
          anubis: ANUBIS_HOME,
          global: RA_GLOBAL,
          lastCwd: last?.cwd,
          lane: last?.timings?.length ? formatLaneLine(last) : null,
          intent: last?.intent ? formatIntentLine(last) : null,
        }),
      );
      return true;
    }
    case "simple":
      c.session.simpleMode = arg !== "off";
      c.reply(c.session.simpleMode ? "Simple mode ON — use /plan then /code" : "Pro mode ON");
      return true;
    case "roles":
      c.reply(`${formatAssignments(resolveAll(c.config))}\nRA prefer small@251 → big@cloud`);
      return true;
    case "cost": {
      const { loadLastRun, formatLaneLine, formatIntentLine, formatPreferLine } = await import("../../../anubis/src/last-run.ts");
      const last = loadLastRun();
      const lines = [
        "RA cost",
        formatReport(buildReport(loadUsage())),
        formatPreferLine(last),
        last?.timings?.length ? formatLaneLine(last) : null,
        last?.intent ? formatIntentLine(last) : null,
      ].filter(Boolean);
      c.reply(lines.join("\n"));
      return true;
    }
    case "status": {
      const { loadLastRun } = await import("../../../anubis/src/last-run.ts");
      const { formatRaStatus } = await import("../../../anubis/src/ra-status.ts");
      const usage = formatReport(buildReport(loadUsage()));
      c.reply(
        formatRaStatus({
          cwd: c.ctx.cwd,
          profile: c.config.profile,
          model: c.config.model,
          small: c.config.small_model,
          simple: c.session.simpleMode,
          messages: c.session.messages.length,
          last: loadLastRun(),
          usage,
        }),
      );
      return true;
    }
    case "clear": {
      c.session.messages = [];
      c.reply("RA session cleared.");
      return true;
    }
    case "sessions": {
      const { listSessions, formatSessions } = await import("../server/session.ts");
      c.reply(formatSessions(listSessions()));
      return true;
    }
    case "doctor": {
      const { runDoctor } = await import("../doctor.ts");
      // Capture doctor output into reply by temporarily wrapping console.log
      const lines: string[] = ["RA doctor"];
      const orig = console.log;
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      };
      try {
        await runDoctor();
      } finally {
        console.log = orig;
      }
      c.reply(lines.join("\n"));
      return true;
    }
    case "selfcheck": {
      const { formatSelfcheck } = await import("../../../anubis/src/selfcheck.ts");
      loadEnv(ANUBIS_HOME);
      const { text } = await formatSelfcheck(c.config, process.env as Record<string, string | undefined>);
      c.reply(text);
      return true;
    }
    case "files": {
      const { loadLastRun, formatRaFiles } = await import("../../../anubis/src/last-run.ts");
      c.reply(formatRaFiles(loadLastRun()));
      return true;
    }
    case "show": {
      const { loadLastRun, formatShow } = await import("../../../anubis/src/last-run.ts");
      c.reply(formatShow(loadLastRun()));
      return true;
    }
    case "result": {
      const { loadLastRun, formatResultLine, formatLaneLine, formatIntentLine, formatPreferLine } = await import("../../../anubis/src/last-run.ts");
      const run = loadLastRun();
      c.reply(
        run
          ? `${formatResultLine(run)}\n${formatLaneLine(run)}\n${formatIntentLine(run)}\n${formatPreferLine(run)}\nagain: ra again --quick --verify`
          : "No previous RA full-dev run.",
      );
      return true;
    }
    case "lane": {
      const { loadLastRun, formatLaneLine } = await import("../../../anubis/src/last-run.ts");
      const run = loadLastRun();
      c.reply(run ? formatLaneLine(run) : "No previous RA full-dev run.");
      return true;
    }
    case "intent": {
      const { loadLastRun, formatIntentLine } = await import("../../../anubis/src/last-run.ts");
      c.reply(formatIntentLine(loadLastRun()));
      return true;
    }
    case "prefer": {
      const { loadLastRun, formatPreferLine } = await import("../../../anubis/src/last-run.ts");
      c.reply(formatPreferLine(loadLastRun()));
      return true;
    }
    case "summary": {
      const { loadLastRun, formatRaSummary } = await import("../../../anubis/src/last-run.ts");
      c.reply(formatRaSummary(loadLastRun()));
      return true;
    }
    case "timings": {
      const { loadLastRun, formatRaTimings } = await import("../../../anubis/src/last-run.ts");
      c.reply(formatRaTimings(loadLastRun()));
      return true;
    }
    case "verify": {
      const { loadLastRun } = await import("../../../anubis/src/last-run.ts");
      const { verifyLastRun } = await import("../../../anubis/src/verify.ts");
      const { lines } = await verifyLastRun(loadLastRun());
      c.reply(lines.join("\n"));
      return true;
    }
    case "history": {
      const { loadHistory, formatHistory } = await import("../../../anubis/src/history.ts");
      c.reply(`RA history\n${formatHistory(loadHistory(8))}`);
      return true;
    }
    case "lan-scan": {
      const found = await scanSubnet("192.168.1.0/24");
      c.reply(formatDiscovery(found));
      return true;
    }
    case "replay": {
      const { replayTimeline, replayTranscript, replayUpTo, findStep } = await import("../server/replay.ts");
      const steps = replayTimeline(c.session);
      if (!steps.length) { c.reply("RA replay\n(no messages in this session)"); return true; }
      if (arg === "list" || !arg) {
        const lines = ["RA replay", ""];
        for (const s of steps) {
          const preview = s.content.slice(0, 80) + (s.content.length > 80 ? "…" : "");
          lines.push(`  ${s.index}. [${s.role}] ${preview}`);
        }
        c.reply(lines.join("\n"));
        return true;
      }
      const n = parseInt(arg, 10);
      if (!isNaN(n) && n >= 0 && n < steps.length) {
        const transcript = replayTranscript(c.session, n);
        c.reply(`RA replay (up to step ${n})\n${transcript}`);
        return true;
      }
      // Try finding by keyword
      const idx = findStep(c.session, (m) => m.content.toLowerCase().includes(arg.toLowerCase()));
      if (idx >= 0) {
        const transcript = replayTranscript(c.session, idx);
        c.reply(`RA replay (found at step ${idx})\n${transcript}`);
        return true;
      }
      c.reply(`RA replay\nNo step matching "${arg}" found. Use /replay list to see all steps.`);
      return true;
    }
    case "connect": {
      // Default to the local daemon on the internal port (8080). External
      // 7788 → internal 8080 mapping happens at the proxy layer.
      const url = arg || process.env.RA_REMOTE || "http://127.0.0.1:8080";
      const { RemoteClient } = await import("../server/remote.ts");
      const client = new RemoteClient({ url });
      const ok = await client.health();
      if (ok) {
        c.reply(`RA connect\nConnected to daemon at ${url}`);
      } else {
        c.reply(`RA connect\nCannot reach daemon at ${url}. Is 'ra daemon' running on 8080?`);
      }
      return true;
    }
    case "tree": {
      // Prefer the live tracker (set by the TUI, populated by agent spawns);
      // fall back to a transient session property for non-TUI callers.
      const { getActiveSubagentTracker } = await import("../agent.ts");
      const { SubagentTree } = await import("../tui/tree.ts");
      const tree = getActiveSubagentTracker() ?? (c.session as Session & { _subagentTree?: SubagentTree })._subagentTree;
      if (!tree || !tree.hasTree) {
        c.reply("RA tree\n(no subagents spawned in this session)");
        return true;
      }
      c.reply(tree.render());
      return true;
    }
    case "todos": {
      const { listTodos, formatTodos, toolTodo } = await import("../tools/index.ts");
      if (/^(done|rm)\s+\d+/.test(arg)) {
        c.reply(`RA todos\n${toolTodo(c.ctx, arg)}`);
        return true;
      }
      c.reply(`RA todos\n${formatTodos(listTodos(c.ctx))}\n\n/todos done <id> to complete · the agent manages items via TODO add/done`);
      return true;
    }
    case "models": {
      const { formatRaModels } = await import("../../../anubis/src/models-list.ts");
      const env = loadEnv(ANUBIS_HOME);
      c.reply(await formatRaModels(c.config, env));
      return true;
    }
    case "plan":
      return runRole("thoth", arg || "survey project", c);
    case "code":
      return runRole("ptah", arg || "implement from plan", c);
    case "review":
      return runRole("maat", arg || "review recent changes", c);
    case "critique":
      return runRole("sekhmet", arg || "adversarial review", c);
    case "docs":
      return runRole("seshat", arg || "document the project", c);
    case "quick":
      return runFullDev(arg, ["thoth", "ptah"], c);
    case "again": {
      const { loadLastRun, formatLaneLine, formatIntentLine } = await import("../../../anubis/src/last-run.ts");
      const last = loadLastRun();
      if (!last?.task) {
        c.reply("RA again: no last run. Try /quick first.");
        return true;
      }
      const cwd = last.cwd ?? c.ctx.cwd;
      const pre = [
        `RA again → ${cwd}`,
        `task: ${last.task.slice(0, 120)}`,
        last.timings?.length ? formatLaneLine(last) : null,
        formatIntentLine(last),
      ]
        .filter(Boolean)
        .join("\n");
      c.reply(pre);
      const plan = planPipeline(last.task, ["thoth", "ptah"]);
      if (!plan) {
        c.reply("Invalid pipeline stages");
        return true;
      }
      c.reply(`RA full-dev → ${plan.stages.join(" → ")}`);
      const result = await runFullDevTask(last.task, {
        root: ANUBIS_HOME,
        stages: plan.stages,
        cwd,
      });
      c.reply(`Files: ${result.filesWritten.join(", ") || "(none)"}`);
      return true;
    }
    case "agents": {
      const { agentCatalog } = await import("./teams.ts");
      c.reply(agentCatalog(c.config).map(a => `${a.role}: ${a.model} · max ${a.maxSteps} steps`).join("\n"));
      return true;
    }
    case "swarm": {
      const { swarmCommand, commandWords } = await import("./teams.ts");
      const result = await swarmCommand(commandWords(arg), c.ctx.cwd, c.config, c.reply);
      c.reply(result.text);
      return true;
    }
    case "moa":
      return runMoa(arg, c);
    case "pipeline":
      return runFullDev(arg, c.config.pipeline?.stages ?? DEFAULT_PIPELINE_STAGES, c);
    default: {
      // Custom slash commands (Markdown-defined)
      const custom = loadCustomCommands(customCommandDirs(c.ctx.cwd)).find((cc) => cc.name === slashCmd);
      if (custom) {
        const env = loadEnv(ANUBIS_HOME);
        // $ARGUMENTS / $1..$N substitution from the user's input.
        let prompt = custom.prompt;
        const hasPlaceholders = /\$ARGUMENTS|\$\d/.test(prompt);
        if (hasPlaceholders) {
          const words = arg.split(/\s+/).filter(Boolean);
          prompt = prompt
            .replace(/\$ARGUMENTS/g, arg)
            .replace(/\$(\d+)/g, (_, n) => words[Number(n) - 1] ?? "");
        } else if (arg) {
          prompt += `\n\nUser input: ${arg}`;
        }
        const result = await runTaskAgent(custom.agent ?? "anubis", prompt, c.config, c.ctx, env);
        c.reply(`## ${custom.name}\n${result.output}`);
        return true;
      }
      c.reply(`Unknown: /${slashCmd}. Try /help`);
      return true;
    }
  }
}

async function runRole(role: string, task: string, c: CommandContext): Promise<boolean> {
  if (!task) { c.reply(`Usage: /${role} <task>`); return true; }
  const tier = classifyTier(task, role === "ptah" ? "code" : role === "thoth" ? "plan" : undefined);
  const tierModels = (c.config as RaConfig & { tier_models?: Record<string, string> }).tier_models;
  c.reply(`${c.session.simpleMode ? "Working on it…" : `[${role}] tier=${tier} model=${tierModels ? tierModel(tier, tierModels) : resolveRoleModel(role, c.config).model}`}`);
  const env = loadEnv(ANUBIS_HOME);
  const result = await runTaskAgent(role, task, c.config, c.ctx, env);
  const fbNote = (result.fallbacks ?? []).map((f) => `↪ fallback: ${f.from} unavailable → ${f.to}`).join("\n");
  c.reply(`## ${result.role} (${result.model})\n${result.output}${fbNote ? `\n\n${fbNote}` : ""}`);
  return true;
}

async function runFullDev(task: string, stages: string[], c: CommandContext): Promise<boolean> {
  if (!task) { c.reply("Usage: /quick|/pipeline <task>"); return true; }
  const plan = planPipeline(task, stages);
  if (!plan) { c.reply("Invalid pipeline stages"); return true; }
  c.reply(`RA full-dev → ${plan.stages.join(" → ")}`);
  const result = await runFullDevTask(task, {
    root: ANUBIS_HOME,
    stages: plan.stages,
    cwd: c.ctx.cwd,
  });
  c.reply(
    `Files: ${result.filesWritten.join(", ") || "(none)"}\n` +
      (result.filesWritten.length ? "" : result.summary.slice(0, 800)),
  );
  return true;
}

async function runMoa(task: string, c: CommandContext): Promise<boolean> {
  if (!task) { c.reply("Usage: /moa <task>"); return true; }
  const { runMoaTeam, formatTeam } = await import("../team.ts");
  c.reply(formatTeam(await runMoaTeam(task, c.config, c.ctx, { onProgress: c.reply })));
  return true;
}

export const PALETTE_COMMANDS = [
  "/help", "/plan", "/code", "/quick", "/again", "/review", "/moa", "/pipeline",
  "/roles", "/models", "/cost", "/status", "/files", "/show", "/result", "/lane", "/intent", "/prefer", "/summary", "/timings", "/verify", "/history", "/ls", "/doctor", "/selfcheck", "/lanes", "/home", "/which", "/clear", "/lan-scan", "/todos",
  "/simple on", "/simple off", "/palette",
  "/replay list", "/connect", "/tree", "/agents", "/swarm help", "/swarm list", "/sandbox status",
];
