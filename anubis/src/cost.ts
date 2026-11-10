// src/cost.ts — cost-tracker estimation + ~/.ra/usage.json persistence
// Prices in USD per million tokens. Local/LAN = free.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ModelPrice {
  in: number;
  out: number;
}

const PRICE_TABLE: Record<string, ModelPrice> = {
  "anthropic/claude-sonnet-4-5": { in: 3, out: 15 },
  "anthropic/claude-opus-4-5": { in: 15, out: 75 },
  "anthropic/claude-haiku-4-5": { in: 1, out: 5 },
  // Native AnthropicClient result ids (claude/<model>)
  "claude/claude-sonnet-4-5": { in: 3, out: 15 },
  "claude/claude-opus-4-5": { in: 15, out: 75 },
  "claude/claude-haiku-4-5": { in: 1, out: 5 },
  "google/gemini-2.5-pro": { in: 1.25, out: 10 },
  "google/gemini-2.5-flash": { in: 0.075, out: 0.3 },
  "openai/gpt-5": { in: 1.25, out: 10 },
  "openai/o3-mini": { in: 1.1, out: 4.4 },
  "zai/glm-4.6": { in: 0.6, out: 2.2 },
  // Ollama Cloud — rough; subscription often applies
  "ollama-cloud/glm-5.2": { in: 0, out: 0 },
};

const FREE_PREFIXES = ["ollama/", "ollama-lan/", "lmstudio/", "lmstudio-lan/", "llamacpp/", "llamacpp-lan/"];

export function isFree(model: string): boolean {
  return FREE_PREFIXES.some((p) => model.startsWith(p));
}

// ---- config-driven price overrides (per-provider pricing, D2) ----

/** User-facing pricing shape: USD per million tokens. */
export interface PricingEntry {
  input_per_m?: number;
  output_per_m?: number;
}

/** Registered price overrides (keyed `provider/model`); consulted before the static table. */
let priceOverrides: Record<string, ModelPrice> = {};

export function setPriceOverrides(map: Record<string, ModelPrice>): void {
  priceOverrides = map;
}

/** Test hygiene: drop registered overrides. */
export function clearPriceOverrides(): void {
  priceOverrides = {};
}

/**
 * Build the override map from ra.json. Sources (later wins):
 *   1. `provider.<name>.options.pricing {input_per_m, output_per_m}` —
 *      default for every model under that provider;
 *   2. `provider.<name>.models.<id>.cost {input, output}` — per-model
 *      (schema identical to opencode.json providers);
 *   3. top-level `pricing: {"provider/model": {input_per_m, output_per_m}}`.
 * Pure; malformed entries are skipped, never thrown.
 */
export function priceOverridesFromConfig(config: {
  provider?: unknown;
  pricing?: Record<string, PricingEntry>;
}): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  const add = (key: string, i: unknown, o: unknown) => {
    const inPerM = Number(i);
    const outPerM = Number(o);
    if (Number.isFinite(inPerM) && inPerM >= 0 && Number.isFinite(outPerM) && outPerM >= 0 && (inPerM > 0 || outPerM > 0)) {
      out[key] = { in: inPerM, out: outPerM };
    }
  };
  const providers = (config.provider ?? {}) as Record<string, {
    options?: { pricing?: PricingEntry };
    models?: Record<string, { cost?: { input?: number; output?: number } }>;
  }>;
  for (const [name, def] of Object.entries(providers)) {
    if (!def || typeof def !== "object") continue;
    const perProvider = def.options?.pricing;
    for (const [id, model] of Object.entries(def.models ?? {})) {
      if (perProvider) add(`${name}/${id}`, perProvider.input_per_m, perProvider.output_per_m);
      if (model?.cost) add(`${name}/${id}`, model.cost.input, model.cost.output);
    }
  }
  for (const [key, p] of Object.entries(config.pricing ?? {})) add(key, p?.input_per_m, p?.output_per_m);
  return out;
}

export function priceFor(model: string): ModelPrice {
  if (isFree(model)) return { in: 0, out: 0 };
  if (priceOverrides[model]) return priceOverrides[model]!;
  const table = PRICE_TABLE[model];
  if (table) return table;
  // ponytail: bare-suffix match so tagged usage rows (e.g. ollama-cloud/<id>,
  // recorded when a custom provider reports a bare model id) still find their
  // provider/<id> override; first key wins — two providers sharing a bare id collide.
  const bare = model.split("/").pop()!;
  for (const key of Object.keys(priceOverrides)) {
    if (key === bare || key.endsWith(`/${bare}`)) return priceOverrides[key]!;
  }
  return { in: 0, out: 0 };
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}

/**
 * True for cloud models priced at zero — usage is covered by the Ollama
 * subscription rather than billed per token. Displayed as "subscription"
 * instead of a misleading $0.000000.
 */
export function isSubscriptionCovered(model: string): boolean {
  if (!model.startsWith("ollama-cloud/")) return false;
  const p = priceFor(model);
  return p.in === 0 && p.out === 0;
}

/** Format a model's cost, annotating subscription-covered usage. */
export function formatCost(model: string, cost: number): string {
  return isSubscriptionCovered(model) ? "subscription" : `$${cost.toFixed(6)}`;
}

export interface UsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CostReport {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export function buildReport(usage: Record<string, UsageEntry>): CostReport[] {
  return Object.entries(usage).map(([model, u]) => ({
    model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cost: estimateCost(model, u.inputTokens, u.outputTokens),
  }));
}

export function formatReport(reports: CostReport[]): string {
  if (reports.length === 0) return "No usage recorded.";
  const lines = reports.map(
    (r) =>
      `${r.model}: ${r.inputTokens} in / ${r.outputTokens} out — ${formatCost(r.model, r.cost)}`,
  );
  const billable = reports.filter((r) => !isSubscriptionCovered(r.model));
  const total = billable.reduce((s, r) => s + r.cost, 0);
  const subCount = reports.length - billable.length;
  lines.push(`TOTAL: $${total.toFixed(6)}${subCount ? ` (+${subCount} subscription-covered model${subCount > 1 ? "s" : ""})` : ""}`);
  return lines.join("\n");
}

export function usagePath(): string {
  return join(homedir(), ".ra", "usage.json");
}

/**
 * Atomic write helper (F6, Wave 3c): tmp file + rename in the same directory,
 * the pattern saveRaConfig already uses for ra.json. rename(2) is atomic, so
 * a concurrent reader never observes a half-written file — it sees either the
 * old or the new JSON.
 */
export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function loadUsage(): Record<string, UsageEntry> {
  return loadUsageJson(usagePath());
}

/**
 * Tolerant JSON read (F6, Wave 3c): corrupt content (a torn or hand-mangled
 * file) is moved aside to `<path>.corrupt-<ms>` and accounting starts fresh —
 * cost reporting never crashes. A valid-but-non-object file also resets.
 * ponytail: concurrent processes still race read-modify-write (last writer
 * wins per row); the atomic write narrows the window to lost updates, it
 * cannot produce corrupt rows. Full fix = lock file or per-process merge.
 */
export function loadUsageJson(path: string): Record<string, UsageEntry> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, UsageEntry>
      : backupCorrupt(path, `top-level ${Array.isArray(parsed) ? "array" : typeof parsed}`);
  } catch (e) {
    return backupCorrupt(path, String(e instanceof Error ? e.message : e).slice(0, 120));
  }
}

function backupCorrupt(path: string, reason: string): Record<string, UsageEntry> {
  try {
    renameSync(path, `${path}.corrupt-${Date.now()}`);
  } catch { /* best-effort backup; a fresh file replaces it on next save */ }
  console.warn(`RA usage: ${path} was corrupt (${reason}) — backed up, starting fresh.`);
  return {};
}

export function saveUsage(usage: Record<string, UsageEntry>): void {
  writeJsonAtomic(usagePath(), usage);
}

export function clearUsage(): void {
  saveUsage({});
}

export interface SessionUsage {
  session: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/**
 * Break down per-session usage into a flat list. Reads the session-usage store
 * (populated when `recordChatUsage` is called with a session key).
 */
export function sessionUsage(data: Record<string, Record<string, UsageEntry>> = loadSessionUsage()): SessionUsage[] {
  const out: SessionUsage[] = [];
  for (const [session, perModel] of Object.entries(data)) {
    for (const [model, u] of Object.entries(perModel)) {
      out.push({
        session,
        model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cost: estimateCost(model, u.inputTokens, u.outputTokens),
      });
    }
  }
  return out;
}

/** Format a per-session/per-model cost dashboard. */
export function formatSessionUsage(rows: SessionUsage[]): string {
  if (!rows.length) return "No usage recorded.";
  const lines = rows.map(
    (r) => `${r.session} · ${r.model}: ${r.inputTokens} in / ${r.outputTokens} out — $${r.cost.toFixed(6)}`,
  );
  const total = rows.reduce((s, r) => s + r.cost, 0);
  lines.push(`TOTAL: $${total.toFixed(6)}`);
  return lines.join("\n");
}

/** Tag bare model id with provider for free/paid classification */
export function tagModel(model: string, cloud: boolean): string {
  if (model.includes("/")) return model;
  return cloud ? `ollama-cloud/${model}` : `ollama-lan/${model}`;
}

export function addUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  usage = loadUsage(),
): Record<string, UsageEntry> {
  const cur = usage[model] ?? { model, inputTokens: 0, outputTokens: 0 };
  cur.inputTokens += Math.max(0, inputTokens | 0);
  cur.outputTokens += Math.max(0, outputTokens | 0);
  usage[model] = cur;
  saveUsage(usage);
  return usage;
}

/** ~4 chars/token heuristic when a provider omits usage (shared with the context ledger). */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function recordChatUsage(
  model: string,
  cloud: boolean,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
  approxChars?: { in: number; out: number },
  session?: string,
): void {
  const tagged = tagModel(model, cloud);
  let inn = usage?.prompt_tokens ?? 0;
  let out = usage?.completion_tokens ?? 0;
  if (!inn && !out && approxChars) {
    inn = estimateTokensFromChars(approxChars.in);
    out = estimateTokensFromChars(approxChars.out);
  }
  if (inn || out) addUsage(tagged, inn, out);
  if (session) recordSessionUsage(session, tagged, inn, out);
}

const SESSION_USAGE_PATH = () => join(homedir(), ".ra", "session-usage.json");

export function loadSessionUsage(): Record<string, Record<string, UsageEntry>> {
  const p = SESSION_USAGE_PATH();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, Record<string, UsageEntry>>;
  } catch {
    return {};
  }
}

export function saveSessionUsage(data: Record<string, Record<string, UsageEntry>>): void {
  writeJsonAtomic(SESSION_USAGE_PATH(), data);
}

function recordSessionUsage(session: string, model: string, inputTokens: number, outputTokens: number): void {
  const data = loadSessionUsage();
  const perModel = data[session] ?? {};
  const cur = perModel[model] ?? { model, inputTokens: 0, outputTokens: 0 };
  cur.inputTokens += Math.max(0, inputTokens | 0);
  cur.outputTokens += Math.max(0, outputTokens | 0);
  perModel[model] = cur;
  data[session] = perModel;
  saveSessionUsage(data);
}
