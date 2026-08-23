// src/cost.ts — cost-tracker estimation + ~/.ra/usage.json persistence
// Prices in USD per million tokens. Local/LAN = free.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function priceFor(model: string): ModelPrice {
  if (isFree(model)) return { in: 0, out: 0 };
  return PRICE_TABLE[model] ?? { in: 0, out: 0 };
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
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
      `${r.model}: ${r.inputTokens} in / ${r.outputTokens} out — $${r.cost.toFixed(6)}`,
  );
  const total = reports.reduce((s, r) => s + r.cost, 0);
  lines.push(`TOTAL: $${total.toFixed(6)}`);
  return lines.join("\n");
}

export function usagePath(): string {
  return join(homedir(), ".ra", "usage.json");
}

export function loadUsage(): Record<string, UsageEntry> {
  const p = usagePath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, UsageEntry>;
  } catch {
    return {};
  }
}

export function saveUsage(usage: Record<string, UsageEntry>): void {
  const dir = join(homedir(), ".ra");
  mkdirSync(dir, { recursive: true });
  writeFileSync(usagePath(), JSON.stringify(usage, null, 2), "utf-8");
}

export function clearUsage(): void {
  saveUsage({});
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

export function recordChatUsage(
  model: string,
  cloud: boolean,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
  approxChars?: { in: number; out: number },
): void {
  const tagged = tagModel(model, cloud);
  let inn = usage?.prompt_tokens ?? 0;
  let out = usage?.completion_tokens ?? 0;
  if (!inn && !out && approxChars) {
    // ponytail: ~4 chars/token heuristic when provider omits usage
    inn = Math.ceil(approxChars.in / 4);
    out = Math.ceil(approxChars.out / 4);
  }
  if (inn || out) addUsage(tagged, inn, out);
}
