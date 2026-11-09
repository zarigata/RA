// src/setup.ts — the setup engine: orchestrate the existing discovery code
// (scanHost / pingUrl / buildLanConfig / context table), no TUI, no process.exit.

import { networkInterfaces } from "node:os";
import { existsSync, readFileSync, appendFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { scanHost, scanSubnetBounded, buildLanConfig, LAN_PORTS, type DiscoveredHost } from "./lan.ts";
import { saveRaConfig, loadRaConfig, type RaConfig } from "./config.ts";
import { tableContext } from "./context-limits.ts";
import { formatContext, usableContext, contextPolicy, type ContextInfo } from "./context-limits.ts";
import { profileNotableRegex, pingUrl } from "./ping.ts";

export type ScanFn = (host: string, port: number, timeoutMs?: number) => Promise<string[] | null>;

/** One probe target (Phase 0 localhost / configured-URL entries). */
export interface SetupTarget {
  host: string;
  port: number;
  label: string;   // e.g. "Ollama, localhost"
  url?: string;    // source env URL (configured LAN target only)
}

/** A found server = DiscoveredHost + latency (ms measured around scanHost). */
export interface SetupFound extends DiscoveredHost {
  ms: number;
}

/** Best-guess defaults for the two lanes (§5.5). */
export interface SetupPick {
  small?: string;
  big?: string;
}

export interface SetupResult {
  ok: boolean;
  configPath?: string;
  small?: string;
  big?: string;
  found: Array<{ host: string; port: number; provider: string; name: string; models: string[]; ms: number }>;
  skipped?: boolean;
  reason?: string; // why LAN was skipped / why not ok
}

const LOCAL: Array<{ host: string; port: number; label: string }> = LAN_PORTS.map((d) => ({
  host: "127.0.0.1",
  port: d.port,
  label: `${d.name}, localhost`,
}));

function parseUrl(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    if (!u.hostname) return null;
    return { host: u.hostname, port: u.port ? Number(u.port) : 80 };
  } catch {
    return null;
  }
}

/** Phase 0 — localhost loopback + the configured LAN URL, probed in parallel (300ms each). */
export async function scanLocalTargets(
  env: Record<string, string | undefined>,
  scanFn: ScanFn = scanHost,
): Promise<{ targets: SetupTarget[]; found: SetupFound[] }> {
  const targets: SetupTarget[] = LOCAL.map((t) => ({ ...t }));
  const lanUrl = env.OLLAMA_LAN_URL ?? env.OLLAMA_LOCAL_URL;
  if (lanUrl && lanUrl !== env.OLLAMA_LOCAL_URL) {
    const p = parseUrl(lanUrl);
    if (p && !targets.some((t) => t.host === p.host && t.port === p.port)) {
      targets.push({ host: p.host, port: p.port, label: "Ollama, configured LAN URL", url: lanUrl });
    }
  }
  const probe = async (t: SetupTarget): Promise<SetupFound | null> => {
    const t0 = Date.now();
    const def = LAN_PORTS.find((d) => d.port === t.port);
    const models = await scanFn(t.host, t.port, 300);
    if (!models || models.length === 0) return null;
    return { host: t.host, port: t.port, provider: def?.provider ?? "ollama-lan", name: def?.name ?? "Ollama", models, ms: Date.now() - t0 };
  };
  const found = (await Promise.all(targets.map(probe))).filter((f): f is SetupFound => f !== null);
  return { targets, found };
}

/** Derive the local /24 from the machine's own interfaces — never hardcoded. */
export function deriveSubnet(interfaces = networkInterfaces()): string | null {
  for (const list of Object.values(interfaces)) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) {
        const m = ni.address.match(/^(\d+\.\d+\.\d+)\.\d+$/);
        if (m) return `${m[1]}.0/24`;
      }
    }
  }
  return null;
}

/** Phase 1 — bounded, cancellable LAN scan with progress. */
export async function scanLanTargets(
  subnet: string | null,
  onProgress?: (line: string) => void,
  scanFn: typeof scanHost = scanHost,
): Promise<{ found: SetupFound[]; skippedReason?: string }> {
  if (!subnet) return { found: [], skippedReason: "No local network interface found — LAN scan skipped." };
  const t0 = Date.now();
  const discovered = await scanSubnetBounded(subnet, {
    concurrency: 32,
    timeoutMs: 300,
    scanFn: async (host, port) => scanFn(host, port, 300),
    onProgress: (p) => onProgress?.(scanProgressLine(subnet, p)),
  });
  // first-found order, latency approximated by probe elapsed (scanSubnetBounded measures none)
  const found: SetupFound[] = discovered.map((d) => ({ ...d, ms: Math.round((Date.now() - t0) / Math.max(1, discovered.length)) }));
  return { found };
}

/** ponytail: live per-host latency inside scanSubnetBounded would mean a
 *  richer ScanProgress; approximation via phase elapsed ÷ hosts is enough
 *  for the wizard's ms display. Upgrade: add per-host ms to ScanProgress. */
export function scanProgressLine(subnet: string, p: { probed: number; total: number; found: number; elapsedMs: number }): string {
  return `Scanning ${subnet} … ${p.probed}/${p.total} hosts · ${p.found} found · ${(p.elapsedMs / 1000).toFixed(1)}s`;
}

/** Model families that make good small (detector) models (§5.5 rule 2). */
const SMALL_FAMILIES = /qwen3|gemma|flint|gpt-oss/i;

export interface LaneStatus { small_model?: string; model?: string; currentSmallOk?: boolean; currentBigOk?: boolean }

/**
 * Pick default lanes (§5.5): keep a working existing lane; else small =
 * first small-family model preferring localhost over LAN and the largest
 * usable context ≤32K; big = cloud only when a key exists.
 */
export function pickDefaults(found: SetupFound[], status: LaneStatus): SetupPick {
  // 1. existing working lane wins
  if (status.currentSmallOk && status.small_model) {
    return { small: status.small_model, big: status.currentBigOk ? status.model : undefined };
  }
  const isLocal = (h: SetupFound) => h.host === "127.0.0.1" || h.host === "localhost";
  const sorted = [...found].sort((a, b) => Number(isLocal(b)) - Number(isLocal(a)));
  const flat = sorted.flatMap((h) => h.models.map((m) => ({ host: h, model: m })));
  // 2. small: small-family match, largest usable context ≤ 32K
  const smallCtx = (m: string): number => usableLeq32K(m).windowTokens;
  const family = flat
    .filter((e) => SMALL_FAMILIES.test(e.model))
    .sort((a, b) => smallCtx(b.model) - smallCtx(a.model))[0];
  const pickSmall = family ?? flat[0];
  // 3. big: cloud key present → keep existing big; else unset (local-only)
  const big = status.currentBigOk ? status.model : undefined;
  return {
    small: pickSmall ? `${pickSmall.host.provider}/${pickSmall.model}` : undefined,
    big,
  };
}

function usableLeq32K(modelId: string): ContextInfo {
  const max = modelMaxContextStatic(modelId);
  const policy = contextPolicy();
  const usable = usableContext(max, modelId, "local", policy);
  return usable.windowTokens > 32768 ? { windowTokens: 32768, source: usable.source } : usable;
}

function modelMaxContextStatic(modelId: string): ContextInfo {
  const t = tableContext(modelId);
  return t != null ? { windowTokens: t, source: "table" } : { windowTokens: 8192, source: "default" };
}

/** Usable-context display for a model on a found host (never the nominal number). */
export function foundContextLine(host: SetupFound, model: string): string {
  return formatContext(usableLeq32K(model), modelMaxContextStatic(model));
}

export interface SaveChoice {
  root: string;
  found: SetupFound[];
  small?: string;
  big?: string;
  /** Cloud key typed in the wizard — written to <root>/.env only, never ra.json. */
  cloudKey?: string;
}

/** Save the lanes + merge provider entries in one saveRaConfig call (§5.5). */
export function saveSetupChoice(choice: SaveChoice): { configPath: string } {
  let cfg: RaConfig = {};
  const raPath = join(choice.root, "ra.json");
  if (existsSync(raPath)) {
    try { cfg = JSON.parse(readFileSync(raPath, "utf-8")) as RaConfig; } catch { cfg = {}; }
  }
  if (choice.small) cfg.small_model = choice.small;
  if (choice.big) cfg.model = choice.big;
  // §5.5: merge provider entries — a found host updates its provider's
  // baseURL + live model list, but never replaces the whole block (options,
  // apiKey templates, and unrelated providers survive).
  const lan = buildLanConfig(choice.found) as { providers: Record<string, Record<string, unknown>> };
  const providers = (cfg.provider ?? {}) as Record<string, Record<string, unknown>>;
  for (const [key, entry] of Object.entries(lan.providers)) {
    providers[key] = { ...providers[key], ...entry };
  }
  cfg.provider = providers;
  if (choice.cloudKey) {
    const providers = cfg.provider as Record<string, { options?: { apiKey?: string; baseURL?: string } }>;
    providers["ollama-cloud"] = {
      ...providers["ollama-cloud"],
      options: { ...providers["ollama-cloud"]?.options, baseURL: providers["ollama-cloud"]?.options?.baseURL ?? "https://ollama.com/v1", apiKey: "{env:OLLAMA_API_KEY}" },
    };
  }
  const configPath = saveRaConfig(cfg, choice.root);
  if (choice.cloudKey) {
    const envPath = join(choice.root, ".env");
    const line = `OLLAMA_API_KEY=${choice.cloudKey}`;
    if (existsSync(envPath)) appendFileSync(envPath, `\n${line}\n`);
    else writeFileSync(envPath, `${line}\n`);
    try { chmodSync(envPath, 0o600); } catch { /* best-effort on odd filesystems */ }
  }
  return { configPath };
}

/** Headless / --json result object (§5.5). */
export function setupResult(args: { ok: boolean; configPath?: string; small?: string; big?: string; found: SetupFound[]; skipped?: boolean; reason?: string }): SetupResult {
  return {
    ok: args.ok,
    configPath: args.configPath,
    small: args.small,
    big: args.big,
    found: args.found.map((f) => ({ host: f.host, port: f.port, provider: f.provider, name: f.name, models: f.models, ms: f.ms })),
    skipped: args.skipped,
    reason: args.reason,
  };
}

/** One-line-per-host summary: `host:port  Name  ms  models… (+N more)`. */
export function setupSummary(found: SetupFound[], choice: { small?: string; big?: string }): string {
  if (found.length === 0) return "No model servers found.";
  const lines = found.map((h) => {
    const shown = h.models.slice(0, 4).join(", ");
    const more = h.models.length > 4 ? ` +${h.models.length - 4} more` : "";
    return `+ ${h.host}:${h.port}  ${h.name.padEnd(10)} ${h.ms}ms  ${shown}${more}`;
  });
  if (choice.small) lines.push(`small: ${choice.small}${choice.big ? ` · big: ${choice.big}` : " · big: unset (local-only)"}`);
  return lines.join("\n");
}

export { pingUrl, profileNotableRegex };
