// moa/layers.ts — Mixture-of-Agents 2.0 (ra.76).
// Layered fan-out per arXiv 2406.04692: layer 1 runs diverse PROPOSERS
// (cross-model: the same prompt on small-lan + cloud + local models), layer 2
// runs CRITICS that see every layer-1 output, then a synthesizer merges all.
// Cost-guarded: an estimate above the budget aborts before any tokens burn.

import { runTaskAgent, aggregateMoa, getActiveSubagentTracker, type TaskResult, type MoAResult } from "../agent.ts";
import { withAgentRun, settledPool, currentScope, runSignal, runStats } from "../execution.ts";
import { estimateCost, isFree } from "../../../anubis/src/cost.ts";
import type { RaConfig } from "../../../anubis/src/config.ts";
import type { ToolContext } from "../tools/index.ts";
import { loadEnv } from "../../../anubis/src/env.ts";
import { ANUBIS_HOME } from "../paths.ts";
import { redact } from "../../../anubis/src/redact.ts";
import { TeamBoard } from "../teams/board.ts";

/** Rough token estimate (~4 chars/token) — same heuristic as cost.ts. */
const estTokens = (text: string): number => Math.ceil(text.length / 4);

export interface LayeredMoaOptions {
  layers?: number;
  /** Cross-model fan-out for layer 1 (overrides config/preset). */
  models?: string[];
  /** Layer-1 proposer agent role (default: general). */
  role?: string;
  /** Critic roles for layer 2 (default: maat, sekhmet). */
  critics?: string[];
  /** Hard cost ceiling in USD for the whole mixture run. */
  budgetUsd?: number;
  concurrency?: number;
  /** Named team preset from config (`teams:` in ra.json). */
  team?: string;
  /** Persist to a team board under ~/.ra/teams/<name>/ when set. */
  boardName?: string;
  /** Board storage root override (tests). */
  boardRoot?: string;
  onProgress?: (message: string) => void;
  /** Test seam: inject a fake synthesis. */
  synthesize?: (task: string, results: ProposalResult[], config: RaConfig) => Promise<string>;
  /** Test seam: inject a fake agent runner. */
  runAgent?: (role: string, task: string, config: RaConfig, ctx: ToolContext, env: Record<string, string>) => Promise<TaskResult>;
}

export interface ProposalResult extends MoAResult {
  layer: number;
  status: "completed" | "failed" | "cancelled";
  ms: number;
  estTokensIn: number;
  estTokensOut: number;
  estCostUsd: number;
  error?: string;
}

export interface LayeredMoaResult {
  status: "completed" | "partial" | "failed" | "cancelled";
  task: string;
  models: string[];
  critics: string[];
  layers: number;
  results: ProposalResult[];
  synthesis: string;
  agreement: AgreementReport;
  estimatedCostUsd: number;
  actualCostUsd: number;
  error?: string;
  stats: ReturnType<typeof runStats>;
  boardPath?: string;
}

// ---- pure planning + analysis ----

export interface LayerPlan {
  models: string[];
  role: string;
  critics: string[];
  layers: number;
  budgetUsd?: number;
}

/** Resolve the effective layer plan: flags > preset > moa config > defaults. */
export function resolveLayerPlan(config: RaConfig, options: LayeredMoaOptions = {}): LayerPlan {
  const preset = options.team ? config.teams?.[options.team] : undefined;
  if (options.team && !preset) throw new Error(`Unknown team preset: ${options.team} (configure it under teams: in ra.json)`);
  const defaultModels = [...new Set([config.small_model ?? "ollama-lan/gpt-oss:20b", config.model].filter(Boolean))];
  return {
    models: options.models ?? preset?.models ?? config.moa?.models ?? defaultModels,
    role: options.role ?? preset?.role ?? "general",
    critics: options.critics ?? preset?.critics ?? ["maat", "sekhmet"],
    layers: Math.max(1, Math.min(3, options.layers ?? preset?.layers ?? config.moa?.layers ?? 2)),
    budgetUsd: options.budgetUsd ?? preset?.budget_usd ?? config.moa?.budget_usd,
  };
}

const FILE_RE = /(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|md|json|html|css|ya?ml)\b/g;

export interface FileAgreement {
  file: string;
  mentionedBy: string[];
  agreement: number;
}

export interface AgreementReport {
  files: FileAgreement[];
  consensus: number;
  notes: string[];
}

/**
 * Pure: per-file agreement across mixture outputs. agreement = fraction of
 * outputs that mention the file; consensus = mean agreement over mentioned
 * files. High disagreement on a hot file is the signal to escalate or
 * re-run — this is what the balanced router consumes.
 */
export function agreementMatrix(outputs: Array<{ source: string; output: string }>): AgreementReport {
  const sources = outputs.map((o) => ({
    source: o.source,
    files: [...new Set((o.output.match(FILE_RE) ?? []).map((f) => f.replace(/^\.\//, "")))],
    errored: /\b(error|failed|cannot|unable)\b/i.test(o.output),
  }));
  const all = new Map<string, string[]>();
  for (const s of sources) for (const f of s.files) {
    if (!all.has(f)) all.set(f, []);
    all.get(f)!.push(s.source);
  }
  const n = sources.length || 1;
  const files: FileAgreement[] = [...all.entries()]
    .map(([file, mentionedBy]) => ({ file, mentionedBy, agreement: mentionedBy.length / n }))
    .sort((a, b) => a.agreement - b.agreement || b.mentionedBy.length - a.mentionedBy.length)
    .slice(0, 12);
  const consensus = files.length ? files.reduce((s, f) => s + f.agreement, 0) / files.length : 1;
  const notes: string[] = [];
  for (const f of files.filter((f) => f.agreement > 0 && f.agreement < 0.5).slice(0, 4)) {
    notes.push(`${f.file}: split — only ${f.mentionedBy.join(", ")} considered it`);
  }
  const errored = sources.filter((s) => s.errored).map((s) => s.source);
  if (errored.length && errored.length < sources.length) {
    notes.push(`${errored.join(", ")} reported failures while others succeeded`);
  }
  return { files, consensus, notes };
}

/** Pure: pre-flight cost estimate for a layered run (USD). Subscription lanes
 *  (0/0 priced, like Ollama Cloud glm-5.2) legitimately estimate ~$0. */
export function estimateMoaCost(plan: LayerPlan, task: string): number {
  const taskTokens = estTokens(task);
  let total = 0;
  for (const model of plan.models) {
    total += estimateCost(model, taskTokens + 500, 1500);
  }
  if (plan.layers >= 2) {
    const layer1Out = 1500 * plan.models.length;
    // Critics are priced at the priciest proposer — a safe upper bound.
    const priciest = plan.models.reduce(
      (a, b) => (estimateCost(b, 1, 1) > estimateCost(a, 1, 1) ? b : a),
      plan.models[0] ?? "cloud",
    );
    for (const _critic of plan.critics) total += estimateCost(priciest, taskTokens + layer1Out, 1000);
  }
  return Number(total.toFixed(4));
}

/** Pure: should the orchestrator offer a mixture for this task? */
export function shouldSuggestMoa(task: string, config: RaConfig): { suggest: boolean; plan: LayerPlan; estCostUsd: number } | null {
  const heavy = /\b(architect|redesign|migrate|refactor|overhaul|rewrite|security|audit|evaluat\w*|design)\b/i.test(task);
  if (!heavy) return null;
  const plan = resolveLayerPlan(config);
  if (plan.models.length < 2) return null;
  return { suggest: true, plan, estCostUsd: estimateMoaCost(plan, task) };
}

// ---- execution ----

/** Force a model for one agent run (mirrors the swarm override pattern). */
function forceModel(config: RaConfig, role: string, model: string): RaConfig {
  const cfg: RaConfig = { ...config, agent: { ...config.agent, [role]: { ...config.agent?.[role], model } } };
  if ("tier_models" in cfg) Object.assign(cfg, { tier_models: undefined });
  return cfg;
}

export async function runLayeredMoa(
  task: string,
  config: RaConfig,
  ctx: ToolContext,
  options: LayeredMoaOptions = {},
): Promise<LayeredMoaResult> {
  if (!task.trim()) throw new Error("Layered MoA needs a task");
  const plan = resolveLayerPlan(config, options);
  if (!plan.models.length || plan.models.length > 8 || new Set(plan.models).size !== plan.models.length) {
    throw new Error("Layered MoA needs 1–8 unique models");
  }
  const estCostUsd = estimateMoaCost(plan, task);
  if (plan.budgetUsd !== undefined && estCostUsd > plan.budgetUsd) {
    throw new Error(`Mixture estimate $${estCostUsd.toFixed(4)} exceeds budget $${plan.budgetUsd.toFixed(4)} (${plan.models.length} models × ${plan.layers} layers). Raise --budget or narrow --models.`);
  }
  const concurrency = options.concurrency ?? config.moa?.concurrency ?? 4;
  const run = options.runAgent ?? runTaskAgent;

  return withAgentRun({ label: "moa", task, limits: config.agent_limits, tree: getActiveSubagentTracker(), signal: ctx.signal, parallel: true }, async () => {
    const env = loadEnv(ANUBIS_HOME);
    const board = options.boardName ? new TeamBoard(options.boardName, options.boardRoot) : null;
    if (board) {
      board.begin(task, `layered mixture · ${plan.models.length} models × ${plan.layers} layers · est $${estCostUsd.toFixed(4)}`);
    }
    const results: ProposalResult[] = [];
    const track = async (
      layer: number, source: string, model: string, work: () => Promise<TaskResult>,
    ): Promise<ProposalResult> => {
      const t0 = Date.now();
      try {
        const r = await work();
        const card: ProposalResult = {
          layer, role: source, model, output: r.output,
          status: "completed", ms: Date.now() - t0,
          estTokensIn: estTokens(task) + 500, estTokensOut: estTokens(r.output),
          estCostUsd: isFree(model) ? 0 : Number(estimateCost(model, estTokens(task) + 500, estTokens(r.output)).toFixed(4)),
        };
        board?.completeCard(source, { model, ms: card.ms, note: r.output.slice(0, 300) });
        options.onProgress?.(`${source}: completed [${model}] ${(card.ms / 1000).toFixed(1)}s`);
        return card;
      } catch (e) {
        const err = redact(String(e)).text;
        board?.failCard(source, err);
        options.onProgress?.(`${source}: failed — ${err.slice(0, 120)}`);
        return { layer, role: source, model, output: "", status: runSignal()?.aborted ? "cancelled" : "failed", ms: Date.now() - t0, estTokensIn: 0, estTokensOut: 0, estCostUsd: 0, error: err };
      }
    };

    // ---- layer 1: cross-model proposers ----
    options.onProgress?.(`MOA layer 1 · proposers on ${plan.models.length} models: ${plan.models.join(", ")}`);
    board?.logMission(`layer 1 fan-out: ${plan.models.join(", ")}`);
    const settled = await settledPool(plan.models, concurrency, async model => {
      board?.addCard(plan.role, `propose on ${model}`, model, 1);
      board?.postMail("coordinator", plan.role, `Propose an answer for: ${task.slice(0, 200)} (running on ${model})`);
      return track(1, `${plan.role}@${model.split("/").pop()}`, model, () =>
        run(plan.role, `Provide an independent proposal for this goal. This is read-only; do not implement it.\n\nGoal: ${task}`, forceModel(config, plan.role, model), ctx, env));
    });
    results.push(...settled.filter((s): s is PromiseFulfilledResult<ProposalResult> => s.status === "fulfilled").map((s) => s.value));

    // ---- layer 2: critics see every layer-1 output ----
    if (plan.layers >= 2 && !runSignal()?.aborted && results.some((r) => r.status === "completed")) {
      const digest = results
        .filter((r) => r.status === "completed")
        .map((r) => `## ${r.role} (${r.model})\n${r.output.slice(0, 3000)}`)
        .join("\n\n")
        .slice(0, 12_000);
      options.onProgress?.(`MOA layer 2 · critics: ${plan.critics.join(", ")}`);
      board?.logMission(`layer 2 critics: ${plan.critics.join(", ")}`);
      const criticSettled = await settledPool(plan.critics, concurrency, async critic => {
        board?.addCard(critic, `critique all layer-1 proposals`, "tier", 2);
        return track(2, `critic:${critic}`, "tier", () =>
          run(critic, `Several agents independently proposed answers. Critique them: find flaws, risks, and the strongest elements. Then say which proposal (or combination) should win and why.\n\nGoal: ${task}\n\nProposals:\n${digest}`, config, ctx, env));
      });
      results.push(...criticSettled.filter((s): s is PromiseFulfilledResult<ProposalResult> => s.status === "fulfilled").map((s) => s.value));
    }

    // ---- synthesis + agreement ----
    const successful = results.filter((r) => r.status === "completed");
    let synthesis = "", error: string | undefined;
    if (successful.length && !runSignal()?.aborted) {
      options.onProgress?.("synthesis: started");
      board?.logMission("synthesis");
      const synth = options.synthesize ?? ((t, rs, cfg) => aggregateMoa(t, rs.map((r) => ({ role: `${r.role} (layer ${r.layer})`, model: r.model, output: r.output })), cfg));
      try {
        synthesis = await synth(task, successful, config);
      } catch (e) { error = redact(String(e)).text; }
    }
    const agreement = agreementMatrix(successful.map((r) => ({ source: `${r.role}`, output: r.output })));
    const actualCostUsd = Number(results.reduce((s, r) => s + r.estCostUsd, 0).toFixed(4));
    const status = runSignal()?.aborted ? "cancelled" : !successful.length ? "failed" : error ? "partial" : "completed";
    const scope = currentScope();
    if (scope?.node && status !== "completed") scope.run.tree?.finishNode(scope.node, status === "cancelled" ? "cancelled" : "error", status);
    if (board) {
      board.finish(status, `consensus ${(agreement.consensus * 100).toFixed(0)}% · actual $${actualCostUsd.toFixed(4)}`);
      if (synthesis) board.postMail("coordinator", "synthesis", synthesis.slice(0, 2000));
    }
    return { status, task, models: plan.models, critics: plan.critics, layers: plan.layers, results, synthesis, agreement, estimatedCostUsd: estCostUsd, actualCostUsd, error, stats: runStats(), boardPath: board?.dir };
  });
}

export function formatLayered(result: LayeredMoaResult): string {
  const cards = result.results.map((r) =>
    `  ${r.status === "completed" ? "✓" : "✗"} L${r.layer} ${r.role} [${r.model}] ${(r.ms / 1000).toFixed(1)}s${r.estCostUsd ? ` · ~$${r.estCostUsd.toFixed(4)}` : " · free"}${r.error ? `: ${r.error.slice(0, 140)}` : ""}`);
  return [
    `MOA ${result.status} · ${result.layers} layers · ${result.results.length} runs · ${result.stats.calls} model calls`,
    `  models: ${result.models.join(", ")}${result.critics.length && result.layers >= 2 ? ` · critics: ${result.critics.join(", ")}` : ""}`,
    `  est $${result.estimatedCostUsd.toFixed(4)} · actual ~$${result.actualCostUsd.toFixed(4)} · consensus ${(result.agreement.consensus * 100).toFixed(0)}%`,
    ...cards,
    ...result.agreement.notes.length ? ["Disagreements:", ...result.agreement.notes.map((n) => `- ${n}`)] : [],
    result.synthesis || "No synthesis available. Successful proposals are retained below.",
    ...(!result.synthesis ? result.results.filter((r) => r.status === "completed").map((r) => `## ${r.role}\n${r.output}`) : []),
    result.error ? `Synthesis error: ${result.error}` : "",
    result.boardPath ? `board: ${result.boardPath} (/board ${result.task ? "" : ""}· ra team status)` : "",
    "Proposals are read-only. Use /code to implement or /swarm for isolated coding tasks.",
  ].filter(Boolean).join("\n");
}
