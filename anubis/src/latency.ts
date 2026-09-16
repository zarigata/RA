// src/latency.ts — rolling per-host latency cache (ra.76).
// ~/.ra/latency.json keeps the last 6 samples per host; feeds status output
// and the balanced router's degraded-local heuristic. Probe ORDER is a
// product contract (.251 first) and is intentionally never changed here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const WINDOW = 6;
const path = (): string => process.env.RA_LATENCY_PATH ?? join(homedir(), ".ra", "latency.json");

type Store = Record<string, number[]>;

function load(): Store {
  try {
    if (existsSync(path())) return JSON.parse(readFileSync(path(), "utf-8")) as Store;
  } catch { /* corrupt cache — start fresh */ }
  return {};
}

function save(store: Store): void {
  try {
    const p = path();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(store));
  } catch { /* best-effort cache */ }
}

/** Record one sample (host tag: "251" | "local" | "lan" | "cloud"). */
export function recordLatency(host: string, ms: number, ok = true): void {
  if (!host || !Number.isFinite(ms) || ms <= 0) return;
  const store = load();
  if (ok) {
    const samples = [...(store[host] ?? []), Math.round(ms)].slice(-WINDOW);
    store[host] = samples;
  } else {
    store[host] = (store[host] ?? []).slice(-WINDOW); // failures don't poison latency
  }
  save(store);
}

/** Median latency for a host in ms, or null when no samples. */
export function latencyFor(host: string): number | null {
  const samples = (load()[host] ?? []).slice().sort((a, b) => a - b);
  if (!samples.length) return null;
  const mid = Math.floor(samples.length / 2);
  return samples.length % 2 ? samples[mid] : Math.round((samples[mid - 1] + samples[mid]) / 2);
}

/** True when the small/local lane is slow enough to prefer escalation.
 *  Considers the best (lowest-median) local host — a fast localhost keeps
 *  the lane healthy even when .251 is struggling. */
export function isLocalDegraded(thresholdMs = 20_000): boolean {
  const medians = [latencyFor("251"), latencyFor("local"), latencyFor("lan")].filter((m): m is number => m !== null);
  if (!medians.length) return false;
  return Math.min(...medians) >= thresholdMs;
}

/** One status line for /status and `ra lane`. */
export function formatLatency(): string {
  const hosts = ["251", "local", "cloud"];
  const parts = hosts
    .map((h) => {
      const ms = latencyFor(h);
      return ms === null ? null : `${h} ${ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}`;
    })
    .filter((x): x is string => x !== null);
  return parts.length ? `latency: ${parts.join(" · ")}` : "latency: no samples yet";
}
