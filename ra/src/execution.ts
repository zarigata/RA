import { AsyncLocalStorage } from "node:async_hooks";
import { SubagentTree, type SubagentNode } from "./tui/tree.ts";

export interface AgentLimits {
  max_calls?: number;
  max_agents?: number;
  max_depth?: number;
  timeout_ms?: number;
}
export interface RunOptions {
  label?: string;
  task?: string;
  limits?: AgentLimits;
  signal?: AbortSignal;
  tree?: SubagentTree | null;
  renderer?: ((token: string) => void) | null;
  parallel?: boolean;
}
interface RunState {
  controller: AbortController;
  maxCalls: number;
  maxAgents: number;
  maxDepth: number;
  calls: number;
  agents: number;
  started: number;
  tree?: SubagentTree | null;
  renderer?: ((token: string) => void) | null;
  parallel: boolean;
}
export interface AgentScope {
  run: RunState;
  node?: SubagentNode;
  depth: number;
}
const scopes = new AsyncLocalStorage<AgentScope>();
const activeRuns = new Set<RunState>();

function limit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
export function currentScope(): AgentScope | undefined { return scopes.getStore(); }
export function checkRun(): void {
  const signal = scopes.getStore()?.run.controller.signal;
  if (signal?.aborted) throw new Error(String(signal.reason ?? "Turn cancelled"));
}
export function runSignal(): AbortSignal | undefined { return scopes.getStore()?.run.controller.signal; }
export function runStats() {
  const run = scopes.getStore()?.run;
  return { calls: run?.calls ?? 0, agents: run?.agents ?? 0, elapsedMs: run ? Date.now() - run.started : 0 };
}
export function cancelRuns(): boolean {
  for (const run of activeRuns) run.controller.abort("Turn cancelled by user");
  return activeRuns.size > 0;
}
export function reserveCall(): AbortSignal {
  const run = scopes.getStore()?.run;
  if (!run) throw new Error("Model call has no execution scope");
  checkRun();
  if (run.calls >= run.maxCalls) {
    run.controller.abort(`Model call budget exhausted (${run.maxCalls})`);
    checkRun();
  }
  run.calls++;
  return run.controller.signal;
}
export function scopedRenderer(): ((token: string) => void) | undefined {
  const scope = scopes.getStore();
  return scope && !scope.run.parallel && scope.depth <= 0 ? scope.run.renderer ?? undefined : undefined;
}

/** One controller and budget span the entire operation, including retries and tools. */
export async function withAgentRun<T>(options: RunOptions, work: () => Promise<T>): Promise<T> {
  if (scopes.getStore()) { checkRun(); return work(); }
  const limits = options.limits ?? {};
  const timeout = limit(limits.timeout_ms, 180_000, "timeout_ms");
  const run: RunState = {
    controller: new AbortController(),
    maxCalls: limit(limits.max_calls, 64, "max_calls"),
    maxAgents: limit(limits.max_agents, 32, "max_agents"),
    maxDepth: limit(limits.max_depth, 3, "max_depth"),
    calls: 0, agents: 0, started: Date.now(),
    tree: options.tree, renderer: options.renderer, parallel: options.parallel ?? false,
  };
  const abort = () => run.controller.abort(options.signal?.reason ?? "Turn cancelled");
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => run.controller.abort(`Run deadline exceeded (${timeout}ms)`), timeout);
  const node = options.label ? run.tree?.startRoot(options.label, options.task ?? "") : undefined;
  activeRuns.add(run);
  try {
    return await scopes.run({ run, node, depth: -1 }, async () => {
      checkRun();
      const result = await work();
      if (node && node.status === "running") run.tree?.finishNode(node, run.controller.signal.aborted ? "cancelled" : "done");
      return result;
    });
  } catch (error) {
    if (node) run.tree?.finishNode(node, run.controller.signal.aborted ? "cancelled" : "error", String(error));
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    activeRuns.delete(run);
  }
}

export async function withAgentScope<T>(role: string, task: string, work: (scope: AgentScope) => Promise<T>): Promise<T> {
  const parent = scopes.getStore();
  if (!parent) throw new Error("Agent has no execution scope");
  checkRun();
  const { run } = parent;
  const depth = parent.depth + 1;
  if (depth > run.maxDepth) throw new Error(`Subagent depth limit reached (${run.maxDepth})`);
  if (run.agents >= run.maxAgents) throw new Error(`Agent budget exhausted (${run.maxAgents})`);
  run.agents++;
  const node = parent.node
    ? run.tree?.beginNode(role, task, parent.node)
    : run.tree?.startRoot(role, task);
  const scope: AgentScope = { run, node, depth };
  return scopes.run(scope, async () => {
    try {
      const result = await work(scope);
      checkRun();
      if (node) run.tree?.finishNode(node, "done");
      return result;
    } catch (error) {
      if (node) run.tree?.finishNode(node, run.controller.signal.aborted ? "cancelled" : "error", String(error));
      throw error;
    }
  });
}

/** Preserve input order and every outcome; an early failure never abandons siblings. */
export async function settledPool<T, R>(items: T[], concurrency: number, work: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("concurrency must be an integer from 1 to 16");
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try { checkRun(); results[index] = { status: "fulfilled", value: await work(items[index], index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}
