import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RaConfig } from "../../../anubis/src/config.ts";
import { loadEnv } from "../../../anubis/src/env.ts";
import { resolveRoleModel } from "../../../anubis/src/router.ts";
import { AGENTS_DIR, ANUBIS_HOME } from "../paths.ts";
import { runTaskAgent, loadAgentMeta, getActiveSubagentTracker } from "../agent.ts";
import { startSwarm, applySwarm, loadSwarm, listSwarms, formatSwarm } from "../swarm.ts";
import { withAgentRun, currentScope } from "../execution.ts";

export function agentCatalog(config: RaConfig) {
  const names = [...new Set([...readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md")).map(f => f.slice(0, -3)), ...Object.keys(config.agent ?? {})])].sort();
  return names.filter(role => /^[a-z][a-z0-9_-]{0,63}$/i.test(role)).map(role => {
    const meta = loadAgentMeta(role);
    return { role, model: meta.model ?? resolveRoleModel(role, config).model, maxSteps: meta.steps ?? 16 };
  });
}
export const SWARM_HELP = `RA swarm — isolated coding teams
  ra swarm run TASKS.json [--concurrency N] [--merge] [--json]
  ra swarm list [--json]
  ra swarm status ID [--json]
  ra swarm apply ID [--json]

TASKS.json is an array: [{"id":"api","prompt":"Implement the API","files":["src/api/"]}]
Optional task fields: model (provider/model), files (owned paths or directories).
Run requires a clean Git checkout and preserves every worktree. Apply is explicit;
--merge applies automatically only when every task succeeded and integration is clean.
After a conflict, resolve and commit in the reported integration worktree, then apply again.`;

/** Quote-aware splitting for TUI arguments; never invokes a shell. */
export function commandWords(text: string): string[] {
  const words: string[] = [];
  let word = "", quote = "", active = false;
  for (const char of text) {
    if (quote) { if (char === quote) quote = ""; else word += char; active = true; }
    else if (char === '"' || char === "'") { quote = char; active = true; }
    else if (/\s/.test(char)) { if (active) words.push(word); word = ""; active = false; }
    else { word += char; active = true; }
  }
  if (quote) throw new Error("Unclosed quote in command");
  if (active) words.push(word);
  return words;
}

export async function swarmCommand(args: string[], cwd: string, config: RaConfig, onProgress?: (message: string) => void) {
  const positional: string[] = [];
  let merge = false, concurrency: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === "--json") continue;
    if (value === "--cwd") { if (!args[++i] || args[i].startsWith("--")) throw new Error("--cwd needs a directory"); continue; }
    if (value === "--merge") { merge = true; continue; }
    if (value === "--concurrency") { if (!args[++i] || args[i].startsWith("--")) throw new Error("--concurrency needs an integer"); concurrency = Number(args[i]); continue; }
    if (value.startsWith("--")) throw new Error(`Unknown swarm option: ${value}`);
    positional.push(value);
  }
  const [action, target] = positional;
  if (!action || action === "help") return { data: { help: SWARM_HELP }, text: SWARM_HELP, code: 0 };
  if (positional.length > (action === "list" ? 1 : 2)) throw new Error("Unexpected swarm argument");
  if (action !== "run" && (merge || concurrency !== undefined)) throw new Error("--merge and --concurrency apply only to swarm run");
  if (action === "list") {
    const data = listSwarms(cwd);
    return { data, text: data.length ? data.map(s => `${s.id} · ${s.status} · ${s.results.length} tasks`).join("\n") : "No recorded swarms.", code: 0 };
  }
  if (!target) throw new Error(SWARM_HELP);
  if (action === "status" || action === "apply") {
    const data = action === "status" ? loadSwarm(cwd, target) : applySwarm(cwd, target);
    return { data, text: formatSwarm(data), code: action === "apply" && data.status !== "applied" ? 1 : 0 };
  }
  if (action !== "run") throw new Error(`Unknown swarm action: ${action}`);
  const tasks = JSON.parse(readFileSync(resolve(cwd, target), "utf-8"));
  const data = await withAgentRun({ label: "swarm", task: target, limits: config.agent_limits, tree: getActiveSubagentTracker(), parallel: true }, async () => {
    const env = loadEnv(ANUBIS_HOME);
    const manifest = await startSwarm({
      repo: cwd, concurrency, onProgress,
      runAgent: async (worktree, task) => {
        const cfg: RaConfig = task.model ? { ...config, agent: { ...config.agent, ptah: { model: task.model } } } : config;
        if (task.model && "tier_models" in cfg) Object.assign(cfg, { tier_models: undefined });
        const ownership = task.files ? `\nOnly change these owned paths: ${task.files.join(", ")}.` : "";
        return runTaskAgent("ptah", `${task.prompt}${ownership}\nUse file tools for edits, verify the result, and do not run git commands; RA handles the branch and commit.`, cfg, { cwd: worktree }, env);
      },
    }, tasks);
    const scope = currentScope();
    if (scope?.node && manifest.status !== "ready") scope.run.tree?.finishNode(scope.node, manifest.status === "cancelled" ? "cancelled" : "error", manifest.status);
    return manifest;
  });
  const result = merge && data.status === "ready" ? applySwarm(cwd, data.id) : data;
  return { data: result, text: formatSwarm(result), code: result.status === "ready" || result.status === "applied" ? 0 : result.status === "cancelled" ? 130 : 1 };
}
