// src/quota.ts — provider quota/rate-limit tracking (ra.77).
// When a provider answers with a quota-style error (429, "rate limit",
// "insufficient quota", billing), RA marks it exhausted for a cooldown and
// the capability router fails over to the next-best provider for the job.
// State persists in ~/.ra/quota.json (RA_QUOTA_PATH overrides, for tests).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_COOLDOWN_MS = 15 * 60_000;

const storePath = (): string => process.env.RA_QUOTA_PATH ?? join(homedir(), ".ra", "quota.json");

type Store = Record<string, { until: number; reason: string; hits: number }>;

function load(): Store {
  try {
    if (existsSync(storePath())) return JSON.parse(readFileSync(storePath(), "utf-8")) as Store;
  } catch { /* corrupt — start fresh */ }
  return {};
}

function save(store: Store): void {
  try {
    const p = storePath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(store));
  } catch { /* best-effort */ }
}

/**
 * Quota-style failures: HTTP 429s and provider quota/billing messages.
 * Deliberately DISTINCT from auth errors (401/403, wrong key) — auth errors
 * never fail over; quota errors must.
 */
export function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (/\b429\b/.test(msg)) return true;
  return /quota|rate[ _-]?limit|too many requests|insufficient(?:\s+\w+)?\s*(?:credits?|balance|funds)?|billing|exceeded your|payment required|capacity/i.test(msg);
}

/** Derive the tracker key for a model or provider id. */
export function quotaKey(modelOrProvider: string): string {
  // provider-prefixed model → provider; bare → the model itself
  const slash = modelOrProvider.indexOf("/");
  return slash > 0 ? modelOrProvider.slice(0, slash) : modelOrProvider;
}

/** Mark a provider exhausted until `until` (default: now + cooldown). */
export function markExhausted(provider: string, reason: string, until = Date.now() + DEFAULT_COOLDOWN_MS): void {
  const key = quotaKey(provider);
  const store = load();
  const prev = store[key];
  store[key] = { until, reason: reason.slice(0, 160), hits: (prev?.hits ?? 0) + 1 };
  save(store);
}

/** Exhaustion expiry timestamp, or null when healthy (expired entries drop). */
export function exhaustedUntil(provider: string, now = Date.now()): number | null {
  const entry = load()[quotaKey(provider)];
  if (!entry) return null;
  if (entry.until <= now) {
    const store = load();
    delete store[quotaKey(provider)];
    save(store);
    return null;
  }
  return entry.until;
}

export function isExhausted(provider: string, now = Date.now()): boolean {
  return exhaustedUntil(provider, now) !== null;
}

/** Clear one provider (a request succeeded again, or the user intervened). */
export function clearExhausted(provider: string): void {
  const store = load();
  delete store[quotaKey(provider)];
  save(store);
}

export interface QuotaHealth {
  provider: string;
  exhaustedUntil: number | null;
  minutesLeft: number;
  hits: number;
  reason: string;
}

/** Snapshot for /providers and `ra providers`. */
export function quotaHealth(now = Date.now()): QuotaHealth[] {
  const store = load();
  const out: QuotaHealth[] = [];
  for (const [provider, entry] of Object.entries(store)) {
    if (entry.until <= now) continue;
    out.push({ provider, exhaustedUntil: entry.until, minutesLeft: Math.ceil((entry.until - now) / 60_000), hits: entry.hits, reason: entry.reason });
  }
  return out.sort((a, b) => a.minutesLeft - b.minutesLeft);
}

export function formatQuota(now = Date.now()): string {
  const health = quotaHealth(now);
  if (!health.length) return "quota: all providers healthy";
  return ["quota:", ...health.map((h) => `  ${h.provider} exhausted — ${h.minutesLeft}m left (${h.hits}× ${h.reason.slice(0, 60)})`)].join("\n");
}
