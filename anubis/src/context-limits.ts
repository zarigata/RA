// src/context-limits.ts — context-window registry (ra.78).
// RA assumes every model is context-starved until proven otherwise: nominal
// "200k context" numbers are never trusted on their own. A model's max window
// resolves as config override > live probe > static table > conservative
// default, and the honest usable window further clamps that max by the serving
// host's num_ctx ceiling (`context.server_cap` — guards LAN VRAM). The agent
// loop plans against the usable window, never the marketing number.

import type { RaConfig } from "./config.ts";
import type { OllamaClient } from "./ollama.ts";
import { estimateTokensFromChars } from "./cost.ts";

export type ContextSource = "config" | "probe" | "table" | "default";

export interface ContextInfo {
  windowTokens: number;
  source: ContextSource;
  /** num_ctx cap applied by the host (local only); present when it clamped. */
  cap?: number;
}

/** Shape of the optional ra.json `context` block. */
export interface ContextPolicyConfig {
  /** Master switch for adaptive low-context runs (default true). */
  adaptive?: boolean;
  /** Max automatic continuations per task before escalation/partial (default 3). */
  resume_limit?: number;
  /** Fraction of the budget where runs switch to wrap-up mode (default 0.7). */
  low_watermark?: number;
  /** Fraction where the run checkpoints and ends for a continuation (default 0.9). */
  critical_watermark?: number;
  /** Global floor: models with less usable context are not routed work (default 8192). */
  min_context_tokens?: number;
  /** Per-provider num_ctx ceilings in tokens — e.g. { "ollama-lan": 32768 }. */
  server_cap?: Record<string, number>;
  /** Manual per-model window overrides, keyed by full or bare model id. */
  model_overrides?: Record<string, number>;
}

export interface ContextPolicy {
  adaptive: boolean;
  resumeLimit: number;
  lowWatermark: number;
  criticalWatermark: number;
  minContextTokens: number;
  serverCap: Record<string, number>;
  modelOverrides: Record<string, number>;
}

/** Conservative unknowns: local servers usually run small num_ctx defaults. */
export const DEFAULT_LOCAL_CONTEXT = 8192;
export const DEFAULT_CLOUD_CONTEXT = 32768;
/** num_ctx ceiling for local hosts without an explicit server_cap entry. */
export const DEFAULT_LOCAL_CAP = 32768;

// Ordered specific → general; first substring match wins (profile-style).
// These are fallbacks — config overrides and live probes win over the table.
const K = 1024;
export const CONTEXT_TABLE: Array<{ match: string[]; window: number; note: string }> = [
  { match: ["qwen3.8"], window: 256 * K, note: "nominal 262k — always clamp with server_cap" },
  { match: ["qwen3-coder", "qwen2.5-coder"], window: 128 * K, note: "coder variants ship long windows" },
  { match: ["qwen"], window: 32 * K, note: "generic qwen — conservative 32k" },
  { match: ["gpt-oss"], window: 128 * K, note: "128k hardware context" },
  { match: ["glm-5", "glm-4"], window: 128 * K, note: "" },
  { match: ["deepseek"], window: 128 * K, note: "" },
  { match: ["kimi"], window: 128 * K, note: "" },
  { match: ["claude"], window: 200 * K, note: "" },
  { match: ["gemini"], window: 128 * K, note: "" },
  { match: ["gpt-5", "gpt-4", "o3", "o4"], window: 128 * K, note: "" },
  { match: ["minimax", "nemotron"], window: 128 * K, note: "" },
  { match: ["gemma2"], window: 8 * K, note: "gemma2 is 8k" },
  { match: ["gemma"], window: 128 * K, note: "gemma3+ 128k" },
  { match: ["llama3.1", "llama3.2", "llama3.3"], window: 128 * K, note: "" },
  { match: ["llama"], window: 8 * K, note: "older llama 8k" },
  { match: ["mistral"], window: 32 * K, note: "" },
  { match: ["phi"], window: 16 * K, note: "" },
];

/** Static-table lookup by substring on the bare model id. */
export function tableContext(modelId: string): number | null {
  const id = modelId.toLowerCase();
  for (const e of CONTEXT_TABLE) {
    if (e.match.some((m) => id.includes(m))) return e.window;
  }
  return null;
}

/** Local/cloud classification from the id prefix or provider baseURL. */
export function modelKind(modelId: string, config?: RaConfig): "local" | "cloud" {
  if (/^(ollama-cloud|cloud)\//i.test(modelId)) return "cloud";
  const providers = config?.provider as Record<string, { options?: { baseURL?: string } }> | undefined;
  const slash = modelId.indexOf("/");
  if (slash > 0 && providers) {
    const url = providers[modelId.slice(0, slash)]?.options?.baseURL ?? "";
    if (url && !/localhost|127\.0\.0\.1|192\.168\./.test(url)) return "cloud";
  }
  return "local";
}

/** Resolve the `context` config block with defaults. */
export function contextPolicy(config?: Partial<Pick<RaConfig, "context">>): ContextPolicy {
  const c = config?.context;
  const low = clamp01(c?.low_watermark ?? 0.7);
  const critical = Math.max(low + 0.01, clamp01(c?.critical_watermark ?? 0.9));
  return {
    adaptive: c?.adaptive !== false,
    resumeLimit: Math.max(0, Math.floor(c?.resume_limit ?? 3)),
    lowWatermark: low,
    criticalWatermark: critical,
    minContextTokens: Math.max(0, c?.min_context_tokens ?? 8192),
    serverCap: c?.server_cap ?? {},
    modelOverrides: c?.model_overrides ?? {},
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0.05, n));
}

/** `provider/model` entry carrying an explicit context override in ra.json. */
function providerModelOverride(modelId: string, config?: RaConfig): number | null {
  const providers = config?.provider as Record<string, { models?: Record<string, { context?: number }> }> | undefined;
  const slash = modelId.indexOf("/");
  if (slash <= 0 || !providers) return null;
  const entry = providers[modelId.slice(0, slash)]?.models?.[modelId.slice(slash + 1)];
  return typeof entry?.context === "number" && entry.context > 0 ? Math.floor(entry.context) : null;
}

/**
 * The model's maximum context window (sync, no network):
 * config override > static table > conservative default by host kind.
 */
export function modelMaxContext(modelId: string, config?: RaConfig): ContextInfo {
  const bare = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  const policy = contextPolicy(config);
  const ov = policy.modelOverrides[modelId] ?? policy.modelOverrides[bare];
  if (typeof ov === "number" && ov > 0) return { windowTokens: Math.floor(ov), source: "config" };
  const pv = providerModelOverride(modelId, config);
  if (pv) return { windowTokens: pv, source: "config" };
  // Table matches only the bare id — matching the full id would hit provider
  // names ("ollama" contains "llama").
  const tv = tableContext(bare);
  if (tv) return { windowTokens: tv, source: "table" };
  return {
    windowTokens: modelKind(modelId, config) === "cloud" ? DEFAULT_CLOUD_CONTEXT : DEFAULT_LOCAL_CONTEXT,
    source: "default",
  };
}

// ---- live probe (cached, 60s; ground truth for installed models) ----

const probeCache = new Map<string, { at: number; window: number | null }>();
const PROBE_TTL_MS = 60_000;

/** Test hook: clear the probe cache. */
export function resetContextProbeCache(): void {
  probeCache.clear();
}

/**
 * Model max context with a live probe folded in (config overrides still win —
 * if the user pinned a number, believe it). The probe asks the serving host
 * (Ollama /api/show, or /v1/models annotations) what the installed model
 * actually reports.
 */
export async function modelMaxContextLive(client: OllamaClient, modelId: string, config?: RaConfig): Promise<ContextInfo> {
  const info = modelMaxContext(modelId, config);
  if (info.source === "config") return info;
  const bare = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  const key = `${client.baseURL}::${bare}`;
  const hit = probeCache.get(key);
  let probed: number | null;
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) {
    probed = hit.window;
  } else {
    probed = await client.showContext(bare);
    probeCache.set(key, { at: Date.now(), window: probed });
  }
  if (typeof probed === "number" && probed > 0) return { windowTokens: Math.floor(probed), source: "probe" };
  return info;
}

/** num_ctx ceiling for a host: explicit server_cap entry, else local default. */
export function serverCapFor(modelId: string, clientKind: "local" | "cloud", policy: ContextPolicy): number | null {
  if (clientKind === "cloud") return null; // no VRAM to guard in the cloud
  const prefix = modelId.includes("/") ? modelId.split("/")[0] : "";
  if (prefix && policy.serverCap[prefix] != null) return policy.serverCap[prefix];
  return DEFAULT_LOCAL_CAP;
}

/**
 * The honest window the agent loop plans against: the model's max clamped by
 * the host's num_ctx ceiling. A "262k" qwen3.8 on a 32k-capped LAN box is a
 * 32k model, full stop.
 */
export function usableContext(max: ContextInfo, modelId: string, clientKind: "local" | "cloud", policy: ContextPolicy): ContextInfo {
  const cap = serverCapFor(modelId, clientKind, policy);
  if (cap != null && max.windowTokens > cap) return { windowTokens: cap, source: max.source, cap };
  return max;
}

/** num_ctx value to send to native Ollama so the server reserves the window. */
export function numCtxFor(windowTokens: number): number {
  return Math.max(2048, Math.floor(windowTokens));
}

/** Tokens reserved for the model's reply inside the window. */
export function outputReserve(windowTokens: number): number {
  return Math.min(8192, Math.max(1024, Math.floor(windowTokens / 8)));
}

export type ContextPressure = "ok" | "low" | "critical";

/**
 * Per-run token ledger. Tracks prompt pressure against the usable window,
 * preferring real usage counts from provider responses and falling back to
 * the ~4 chars/token estimate (whichever is larger — estimate low-balls).
 */
export class ContextLedger {
  private real: { promptTokens: number; completionTokens: number; msgCount: number } | null = null;

  constructor(
    readonly model: string,
    readonly windowTokens: number,
    private readonly policy: Pick<ContextPolicy, "lowWatermark" | "criticalWatermark">,
  ) {}

  /** Prompt budget after the reply reserve. */
  get budgetTokens(): number {
    return Math.max(1, this.windowTokens - outputReserve(this.windowTokens));
  }

  /** Calibrate with real counts from a response (msgCount = messages sent). */
  noteUsage(usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined, msgCount: number): void {
    if (usage && (usage.prompt_tokens ?? 0) > 0) {
      this.real = { promptTokens: usage.prompt_tokens!, completionTokens: usage.completion_tokens ?? 0, msgCount };
    }
  }

  usedTokens(messages: Array<{ content: string }>): number {
    let est = 0;
    for (const m of messages) est += estimateTokensFromChars(m.content.length);
    if (this.real) {
      let extra = 0;
      for (let i = this.real.msgCount; i < messages.length; i++) extra += estimateTokensFromChars(messages[i]?.content.length ?? 0);
      return Math.max(est, this.real.promptTokens + this.real.completionTokens + extra);
    }
    return est;
  }

  pressure(messages: Array<{ content: string }>): ContextPressure {
    const used = this.usedTokens(messages);
    if (used >= this.budgetTokens * this.policy.criticalWatermark) return "critical";
    if (used >= this.budgetTokens * this.policy.lowWatermark) return "low";
    return "ok";
  }

  remaining(messages: Array<{ content: string }>): number {
    return Math.max(0, this.budgetTokens - this.usedTokens(messages));
  }
}

/** Minimum usable context a model must have to be routed a job. */
export function minContextForJob(job: string, policy: Pick<ContextPolicy, "minContextTokens">): number {
  const jobFloor = /^(code|reasoning)$/.test(job) ? 16384 : 8192;
  return Math.max(policy.minContextTokens, jobFloor);
}

/** `ctx 128K·table` / `ctx 32K·capped(262K·probe)` — for /providers, /context, doctor. */
export function formatContext(info: ContextInfo, max?: ContextInfo): string {
  const fmt = (n: number) => (n >= 1024 ? `${Math.round(n / 1024)}K` : String(n));
  if (info.cap != null && max && max.windowTokens > info.windowTokens) {
    return `ctx ${fmt(info.windowTokens)}·capped(${fmt(max.windowTokens)}·${max.source})`;
  }
  return `ctx ${fmt(info.windowTokens)}·${info.source}`;
}
