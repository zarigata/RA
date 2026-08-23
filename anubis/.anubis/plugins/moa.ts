// .anubis/plugins/moa.ts — Mixture-of-Agents engine (/moa parallel + /pipeline sequential)
import {
  buildAggregatePrompt,
  parseRoleOverride,
  stripRoleOverride,
  DEFAULT_MOA_CONFIG,
  type RoleResult,
} from "../../src/aggregator.ts";
import {
  validateStages,
  DEFAULT_PIPELINE_STAGES,
} from "../../src/pipeline.ts";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type AnyCtx = Record<string, unknown>;

interface MoaPluginConfig {
  moa?: { roles?: string[]; parallel?: boolean };
  pipeline?: { stages?: string[] };
}

function readConfig(): MoaPluginConfig {
  const root = process.env.ANUBIS_HOME ?? process.env.RA_HOME ?? ".";
  for (const name of ["ra.json", "anubis.json"]) {
    const p = join(root, name);
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, "utf-8"));
      return { moa: cfg.moa, pipeline: cfg.pipeline };
    }
  }
  return {
    moa: { roles: DEFAULT_MOA_CONFIG.roles, parallel: DEFAULT_MOA_CONFIG.parallel },
    pipeline: { stages: DEFAULT_PIPELINE_STAGES },
  };
}

export const MoaPlugin = async (ctx: AnyCtx) => {
  const client = (ctx as { client?: AnyCtx }).client;
  const taskRunner = (ctx as { runTask?: (role: string, task: string) => Promise<RoleResult> }).runTask;
  const log = async (level: string, message: string) => {
    try {
      await client?.app?.log?.({ body: { service: "moa", level, message } });
    } catch {
      /* no-op */
    }
  };

  async function spawnRole(role: string, task: string): Promise<RoleResult> {
    if (taskRunner) return taskRunner(role, task);
    await client?.session?.prompt?.({ body: { text: `@${role} ${task}` } });
    const model = "(assigned)";
    const output = "(awaiting subagent — use RA runtime /moa for full execution)";
    return { role, model, output };
  }

  async function runMoa(raw: string) {
    const task = stripRoleOverride(raw);
    if (!task) {
      await log("warn", "usage: /moa <task> [@role ...]");
      return;
    }
    const cfg = readConfig();
    const roles = parseRoleOverride(raw) ?? cfg.moa!.roles!;
    await log("info", `MOA parallel roles: ${roles.join(", ")}`);
    const results = await Promise.all(roles.map((r) => spawnRole(r, task)));
    const aggregate = buildAggregatePrompt(task, results);
    await client?.session?.prompt?.({ body: { text: aggregate } });
  }

  async function runPipeline(raw: string) {
    const task = raw.trim();
    if (!task) {
      await log("warn", "usage: /pipeline <task>");
      return;
    }
    const cfg = readConfig();
    const stages = cfg.pipeline!.stages!;
    if (!validateStages(stages)) {
      await log("error", "invalid pipeline stages");
      return;
    }
    await log("info", `PIPELINE stages: ${stages.join(" -> ")}`);
    let current = task;
    for (const stage of stages) {
      const r = await spawnRole(stage, current);
      current = `${task}\n\n[previous: ${r.role}]\n${r.output}`;
    }
    await client?.session?.prompt?.({ body: { text: current } });
  }

  return {
    "tui.command.execute": async (input: AnyCtx, output: AnyCtx) => {
      const cmd = (input.command as string) ?? "";
      if (cmd.startsWith("/moa ")) {
        (output as { handled?: boolean }).handled = true;
        await runMoa(cmd.replace(/^\/moa\s+/, ""));
      } else if (cmd.startsWith("/pipeline ")) {
        (output as { handled?: boolean }).handled = true;
        await runPipeline(cmd.replace(/^\/pipeline\s+/, ""));
      }
    },
  };
};

export { validateStages, DEFAULT_PIPELINE_STAGES, buildAggregatePrompt };
export default MoaPlugin;
