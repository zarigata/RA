import { runTaskAgent, aggregateMoa, getActiveSubagentTracker, type TaskResult } from "./agent.ts";
import { withAgentRun, settledPool, currentScope, runSignal, runStats } from "./execution.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import type { ToolContext } from "./tools/index.ts";
import { loadEnv } from "../../anubis/src/env.ts";
import { ANUBIS_HOME } from "./paths.ts";
import { redact } from "../../anubis/src/redact.ts";

export interface TeamResult {
  status: "completed" | "partial" | "failed" | "cancelled";
  task: string;
  results: Array<TaskResult & { status: "completed" | "failed" | "cancelled"; error?: string }>;
  synthesis: string;
  error?: string;
  stats: ReturnType<typeof runStats>;
}
export interface TeamOptions {
  roles?: string[];
  concurrency?: number;
  onProgress?: (message: string) => void;
}

/** Independent read-only proposals; implementation belongs in /code or isolated worktrees. */
export async function runMoaTeam(task: string, config: RaConfig, ctx: ToolContext, options: TeamOptions = {}): Promise<TeamResult> {
  const roles = options.roles ?? config.moa?.roles ?? ["thoth", "ptah", "maat", "sekhmet"];
  if (!task.trim()) throw new Error("MoA needs a task");
  if (!roles.length || roles.length > 16 || new Set(roles).size !== roles.length || roles.some(r => !/^[a-z][a-z0-9_-]{0,63}$/i.test(r))) throw new Error("MoA needs 1–16 unique valid role names");
  const concurrency = options.concurrency ?? (config.moa?.parallel === false ? 1 : config.moa?.concurrency ?? 4);
  const readonly: RaConfig = {
    ...config,
    permission: { ...config.permission, tool: { ...config.permission?.tool, write: "deny", edit: "deny", bash: "deny", mcp: "deny", todo: "deny" } },
  };
  return withAgentRun({ label: "moa", task, limits: config.agent_limits, tree: getActiveSubagentTracker(), signal: ctx.signal, parallel: true }, async () => {
    const env = loadEnv(ANUBIS_HOME);
    options.onProgress?.(`MOA read-only proposals: ${roles.join(", ")} · concurrency ${concurrency}`);
    const settled = await settledPool(roles, concurrency, async role => {
      options.onProgress?.(`${role}: started`);
      const result = await runTaskAgent(role, `Provide your role's independent proposal or review for this goal. This is read-only; do not implement it.\n\nGoal: ${task}`, readonly, ctx, env);
      options.onProgress?.(`${role}: completed [${result.model}]`);
      return result;
    });
    const results: TeamResult["results"] = settled.map((r, i) => r.status === "fulfilled"
      ? { ...r.value, status: "completed" }
      : { role: roles[i], model: config.agent?.[roles[i]]?.model ?? config.model, output: "", status: runSignal()?.aborted ? "cancelled" : "failed", error: redact(String(r.reason)).text });
    const successful = results.filter(r => r.status === "completed");
    let synthesis = "", error: string | undefined;
    if (successful.length && !runSignal()?.aborted) {
      options.onProgress?.("synthesis: started");
      try { synthesis = await aggregateMoa(task, successful, config); }
      catch (e) { error = redact(String(e)).text; }
    }
    const status = runSignal()?.aborted ? "cancelled" : !successful.length ? "failed" : successful.length < roles.length || error ? "partial" : "completed";
    const scope = currentScope();
    if (scope?.node && status !== "completed") scope.run.tree?.finishNode(scope.node, status === "cancelled" ? "cancelled" : "error", status);
    return { status, task, results, synthesis, error, stats: runStats() };
  });
}

export function formatTeam(result: TeamResult): string {
  return [
    `MOA ${result.status} · ${result.stats.calls} model calls · ${result.stats.agents} agents`,
    ...result.results.map(r => `  ${r.status === "completed" ? "✓" : "✗"} ${r.role} [${r.model}]${r.error ? `: ${r.error}` : ""}`),
    result.synthesis || "No synthesis available. Successful proposals are retained below.",
    ...(!result.synthesis ? result.results.filter(r => r.status === "completed").map(r => `## ${r.role}\n${r.output}`) : []),
    result.error ? `Synthesis error: ${result.error}` : "",
    "Proposals are read-only. Use /code to implement or /swarm for isolated coding tasks.",
  ].filter(Boolean).join("\n");
}
