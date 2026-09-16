// src/routing.ts — hybrid local↔cloud routing (ra.76).
// Four modes, resolved from config or RA_ROUTING:
//   local-first    tier decides (default; unchanged RA behavior)
//   quality-first  everything but meta-tier chat goes to the BIG cloud model
//   economy        everything stays on the small/local lane (hard local-only)
//   balanced       tier decides + cross-kind escalation is allowed
//                  (local primary may escalate to cloud, and vice versa on
//                  budget breach) — the speed/quality combo mode
// The budget guard downshifts cloud work to the local lane once the session
// crosses budget.session_usd, and the escalation chain implements the
// cross-kind steps OUTSIDE fallbackChain (which stays same-kind by contract).

import { buildReport, loadUsage } from "./cost.ts";
import type { RaConfig } from "./config.ts";

export type RoutingMode = "local-first" | "quality-first" | "balanced" | "economy";
export const ROUTING_MODES: RoutingMode[] = ["local-first", "quality-first", "balanced", "economy"];

export function isCloudModelId(model: string): boolean {
  return /^(ollama-cloud|cloud)\//i.test(model);
}

export function resolveRoutingMode(config: Pick<RaConfig, "routing">, env: Record<string, string | undefined> = process.env): RoutingMode {
  const raw = (env.RA_ROUTING ?? config.routing?.mode ?? "local-first").toLowerCase();
  return (ROUTING_MODES as string[]).includes(raw) ? (raw as RoutingMode) : "local-first";
}

/**
 * Pure: adjust a tier-resolved model per routing mode. Called in
 * executeTaskAgent AFTER the tier assignment (and before frontmatter overrides,
 * which always win — an agent that pins its model keeps it).
 */
export function applyRoutingMode(
  configured: string,
  tier: string,
  config: Pick<RaConfig, "routing" | "model" | "small_model">,
): string {
  const mode = resolveRoutingMode(config);
  if (mode === "quality-first") {
    if (tier === "meta") return config.small_model ?? configured;
    return config.model ?? configured;
  }
  if (mode === "economy") {
    return config.small_model ?? configured;
  }
  return configured; // local-first and balanced trust the tier decision
}

// ---- budget guard ----

/** Session spend in USD across all models (from ~/.ra/usage.json). */
export function sessionSpentUsd(): number {
  try {
    return Number(buildReport(loadUsage()).reduce((s, r) => s + r.cost, 0).toFixed(4));
  } catch {
    return 0;
  }
}

/** Pure: is this spend over the configured cap (0/undefined = no cap)? */
export function isOverBudget(spentUsd: number, config: Pick<RaConfig, "budget">): boolean {
  const cap = config.budget?.session_usd;
  if (!cap || cap <= 0) return false;
  return spentUsd >= cap;
}

/** True once the session crosses budget.session_usd (0/undefined = no cap). */
export function budgetBreached(config: Pick<RaConfig, "budget">): boolean {
  return isOverBudget(sessionSpentUsd(), config);
}

/** Pure: the local-lane replacement for a cloud model on budget breach. */
export function downshiftForBudget(
  model: string,
  config: Pick<RaConfig, "budget" | "small_model">,
  spentUsd = sessionSpentUsd(),
): string | null {
  if (!isOverBudget(spentUsd, config) || !isCloudModelId(model)) return null;
  return config.small_model ?? null;
}

/**
 * Pure: cross-kind escalation candidates appended AFTER the user's same-kind
 * fallback chain. Only balanced mode (local→cloud) and budget breach
 * (cloud→local) produce candidates; every other mode returns [].
 */
export function escalationChain(
  primary: string,
  config: Pick<RaConfig, "routing" | "model" | "small_model" | "budget">,
  spentUsd = sessionSpentUsd(),
): string[] {
  const mode = resolveRoutingMode(config);
  const out: string[] = [];
  if (isCloudModelId(primary)) {
    if (downshiftForBudget(primary, config, spentUsd)) out.push(downshiftForBudget(primary, config, spentUsd)!);
    return out;
  }
  if (mode === "balanced" && config.model && isCloudModelId(config.model)) {
    out.push(config.model);
  }
  return out;
}
