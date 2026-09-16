// src/capability.ts — the Provider Mosaic router (ra.77).
// Enumerates every model RA can reach right now (lanes + provider blocks +
// LM Studio/Ollama discovery surface), filters by API-key presence and quota
// health, then ranks by benchmark-driven capability scores with a local
// bonus. Returns the primary pick plus a failover chain for the agent loop.

import type { RaConfig } from "./config.ts";
import { rankForJob, type Job, type RankedModel } from "./profiles.ts";
import { isExhausted, exhaustedUntil } from "./quota.ts";
import { contextPolicy, formatContext, minContextForJob, modelMaxContext, usableContext } from "./context-limits.ts";

export interface CapabilityRouterConfig {
  enabled?: boolean;
  /** Score bonus for local models — the "local assistant, cloud specialist" dial. */
  local_bonus?: number;
  /** Failover chain length after the primary. */
  max_candidates?: number;
  /**
   * Routing-pool allowlist. Missing or ["*"] → every configured provider
   * model (the full-auto mosaic: log providers, RA picks). Explicit ids or
   * `provider/*` prefixes constrain the pool; the two lanes are always in.
   */
  models?: string[];
}

export interface Candidate {
  model: string;
  provider: string;
  kind: "local" | "cloud";
  hasKey: boolean;
}

export interface Skipped {
  model: string;
  reason: string;
}

export interface JobRouting {
  primary: RankedModel;
  chain: string[];
  skipped: Skipped[];
  job: Job;
}

const envKey = (apiKeyTpl: unknown, env: Record<string, string | undefined>): boolean => {
  if (typeof apiKeyTpl !== "string") return true; // no key needed (local)
  const m = apiKeyTpl.match(/^\{env:([A-Z0-9_]+)\}$/);
  if (!m) return true; // static key in config
  return Boolean(env[m[1]]);
};

const isLocalUrl = (baseURL: unknown): boolean =>
  typeof baseURL === "string" && (/localhost|127\.0\.0\.1|192\.168\./.test(baseURL) || baseURL === "");

/**
 * Every model RA could route to right now: the configured lanes plus every
 * provider block's model list (provider-prefixed ids). Pure given (config, env).
 */
export function candidateModels(config: RaConfig, env: Record<string, string | undefined> = process.env): Candidate[] {
  const out = new Map<string, Candidate>();
  const add = (model: string, provider: string, kind: "local" | "cloud", hasKey: boolean) => {
    if (model && !out.has(model)) out.set(model, { model, provider, kind, hasKey });
  };
  if (config.small_model) add(config.small_model, config.small_model.split("/")[0], "local", true);
  if (config.model) add(config.model, config.model.split("/")[0], /^(ollama-cloud|cloud)\//i.test(config.model) ? "cloud" : "local", true);
  for (const [name, def] of Object.entries((config.provider ?? {}) as Record<string, { options?: { baseURL?: string; apiKey?: string }; models?: Record<string, unknown> }>)) {
    const kind: "local" | "cloud" = isLocalUrl(def.options?.baseURL) ? "local" : "cloud";
    const hasKey = envKey(def.options?.apiKey, env);
    for (const modelId of Object.keys(def.models ?? {})) add(`${name}/${modelId}`, name, kind, hasKey);
  }
  return [...out.values()];
}

/**
 * Pick the best model for a job and the failover order behind it.
 * Skips cloud providers without keys and quota-exhausted providers.
 */
export function pickForJob(
  job: Job,
  config: RaConfig,
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): JobRouting | null {
  const router = (config as RaConfig & { capability_router?: CapabilityRouterConfig }).capability_router;
  const localBonus = router?.local_bonus ?? 2;
  const maxCandidates = router?.max_candidates ?? 3;
  const allow = router?.models;
  const lanes = [config.small_model, config.model].filter(Boolean) as string[];
  const inPool = (model: string) =>
    !allow || allow.includes("*") || lanes.includes(model) ||
    allow.some((a) => a.endsWith("/*") && model.startsWith(a.slice(0, -1)));
  const skipped: Skipped[] = [];
  const eligible: Array<{ model: string; local: boolean }> = [];
  const byModel = new Map<string, Candidate>();
  // Context floor (ra.78): a model whose USABLE window (nominal max clamped
  // by the host's num_ctx cap) can't hold the job's prompts is not a
  // candidate — a "262k" id on a 32k-capped box is a 32k model.
  const policy = contextPolicy(config);
  const floor = minContextForJob(job, policy);
  for (const c of candidateModels(config, env)) {
    byModel.set(c.model, c);
    if (!inPool(c.model)) continue;
    if (c.kind === "cloud" && !c.hasKey) { skipped.push({ model: c.model, reason: "no api key" }); continue; }
    const until = exhaustedUntil(c.provider, now);
    if (until !== null) { skipped.push({ model: c.model, reason: `quota — ${Math.ceil((until - now) / 60_000)}m left` }); continue; }
    const usable = usableContext(modelMaxContext(c.model, config), c.model, c.kind, policy);
    if (usable.windowTokens < floor) { skipped.push({ model: c.model, reason: `context ${usable.windowTokens} < ${floor} (${job})` }); continue; }
    eligible.push({ model: c.model, local: c.kind === "local" });
  }
  if (!eligible.length) return null;
  const ranked = rankForJob(eligible, job, localBonus);
  return { primary: ranked[0], chain: ranked.slice(1, 1 + maxCandidates).map((r) => r.model), skipped, job };
}

/** Provider-side skip check used when a chain candidate fails at chat time. */
export function providerExhausted(provider: string, now = Date.now()): boolean {
  return isExhausted(provider, now);
}

// ---- live LM Studio discovery (cached; feeds the candidate pool) ----

let lmCache: { at: number; models: string[]; baseURL: string } | null = null;
const LM_TTL_MS = 60_000;

/** Pick for a job with live LM Studio models merged into the pool. */
export async function pickForJobLive(
  job: Job,
  config: RaConfig,
  env: Record<string, string | undefined> = process.env,
): Promise<JobRouting | null> {
  if (lmCache && Date.now() - lmCache.at < LM_TTL_MS) return pickForJob(job, withLmStudio(config, lmCache), env);
  try {
    const { discoverLocalOpenAI } = await import("./ollama.ts");
    const local = await discoverLocalOpenAI(env);
    lmCache = local
      ? { at: Date.now(), models: (local.availableModels ?? []).slice(0, 8), baseURL: local.baseURL }
      : { at: Date.now(), models: [], baseURL: "" };
  } catch {
    lmCache = { at: Date.now(), models: [], baseURL: "" };
  }
  return pickForJob(job, withLmStudio(config, lmCache), env);
}

function withLmStudio(config: RaConfig, lm: { models: string[]; baseURL: string } | null): RaConfig {
  if (!lm || !lm.models.length) return config;
  return {
    ...config,
    provider: {
      ...config.provider,
      lmstudio: {
        options: { baseURL: lm.baseURL || "http://localhost:1234/v1" },
        models: Object.fromEntries(lm.models.map((m) => [m, {}])),
      },
    },
  } as RaConfig;
}

import { formatProfile } from "./profiles.ts";
import { quotaHealth } from "./quota.ts";

/** Human-readable mosaic state for /providers and `ra providers`. */
export function formatProviders(config: RaConfig, env: Record<string, string | undefined> = process.env): string {
  const router = (config as RaConfig & { capability_router?: CapabilityRouterConfig }).capability_router;
  const on = router?.enabled !== false;
  const lines = [
    `RA providers — capability router ${on ? `on (local_bonus ${router?.local_bonus ?? 2})` : "off"}`,
  ];
  const candidates = candidateModels(config, env);
  const policy = contextPolicy(config);
  if (!candidates.length) {
    lines.push("  (no models configured — set model/small_model or provider blocks in ra.json)");
  }
  for (const c of candidates) {
    const skipped = c.kind === "cloud" && !c.hasKey ? " · no api key (skipped)" : "";
    const quota = quotaHealth().find((h) => h.provider === c.provider);
    const ctx = formatContext(usableContext(modelMaxContext(c.model, config), c.model, c.kind, policy));
    lines.push(`  ${c.model} [${c.kind}${c.provider ? ` · ${c.provider}` : ""}] · ${ctx}${quota ? ` · QUOTA ${quota.minutesLeft}m left` : ""}${skipped}`);
    lines.push(`      ${formatProfile(c.model)}`);
  }
  const health = quotaHealth();
  if (health.length) {
    lines.push("", "quota health:");
    for (const h of health) lines.push(`  ${h.provider} exhausted — ${h.minutesLeft}m left (${h.hits}× ${h.reason.slice(0, 70)})`);
  }
  lines.push("", "failover: quota errors mark the provider exhausted (15m cooldown) and reroute to the next-best model for the job.");
  return lines.join("\n");
}
