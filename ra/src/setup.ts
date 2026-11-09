// src/setup.ts — CLI glue for `ra setup`: flags, subnet derivation, progress
// printing, exit codes. Model logic lives in anubis/src/setup.ts.

import { scanLocalTargets, scanLanTargets, deriveSubnet, pickDefaults, saveSetupChoice, setupResult, setupSummary, pingUrl, type SetupFound, type ScanFn, type SetupResult } from "../../anubis/src/setup.ts";
import { loadRaConfig } from "../../anubis/src/config.ts";
import { loadEnv } from "../../anubis/src/env.ts";
import { ANUBIS_HOME } from "./paths.ts";

export interface SetupFlags {
  rescan?: boolean;
  noLan?: boolean;
  lan?: boolean; // headless opt-in for the LAN scan (--lan, §5.3)
  json?: boolean;
  check?: boolean;
}

export interface SetupDeps {
  env?: Record<string, string | undefined>;
  root?: string;                 // config root (default ANUBIS_HOME)
  scanFn?: ScanFn;
  lanScan?: typeof import("../../anubis/src/lan.ts").scanSubnetBounded;
  log?: (line: string) => void;
  now?: () => number;
}

/** Run the (headless) setup flow. Returns the result object + exit code. */
export async function runSetup(flags: SetupFlags, deps: SetupDeps = {}): Promise<{ result: import("../../anubis/src/setup.ts").SetupResult; code: number }> {
  const env = deps.env ?? { ...loadEnv(ANUBIS_HOME) };
  const root = deps.root ?? ANUBIS_HOME;
  const log = deps.log ?? ((l: string) => console.log(l));
  const now = deps.now ?? Date.now;
  const ascii = env.RA_ASCII === "1" || env.RA_ASCII === "true" || env.TERM === "dumb";
  const mark = (ok: boolean) => (ascii ? (ok ? "+" : "x") : ok ? "✓" : "✗");

  // Existing config + working-lane check (rule 1 of §5.5).
  let cfg: import("../../anubis/src/config.ts").RaConfig | null = null;
  try { cfg = loadRaConfig(root); } catch { cfg = null; }
  const currentSmallOk = !!(cfg?.small_model && (await pingUrl("small", providerUrlForLane(env, cfg.small_model), 3000)).ok);
  const currentBigOk = !!(cfg?.model && (await pingUrl("big", providerUrlForLane(env, cfg.model), 1000)).ok);

  if (flags.check) {
    const { found } = await scanLocalTargets(env, deps.scanFn);
    const ok = found.length > 0 || currentSmallOk;
    if (!flags.json) {
      log(`RA setup check`);
      for (const f of found) log(`${mark(true)} ${f.host}:${f.port}  ${f.name}  ${f.models.length} models  ${f.ms}ms`);
      if (!found.length && currentSmallOk) log(`${mark(true)} configured small model reachable (${cfg?.small_model})`);
      if (!ok) log(`${mark(false)} no small model reachable — run ra setup`);
    }
    const result = setupResult({ ok, small: cfg?.small_model, big: cfg?.model, found, reason: ok ? undefined : "no small model reachable" });
    return { result, code: ok ? 0 : 1 };
  }

  if (flags.json) {
    // Headless JSON mode: localhost-only scan, no prompts, LAN only with --lan.
    const { found } = await scanLocalTargets(env, deps.scanFn);
    let all = found;
    let reason: string | undefined;
    if (flags.lan && !flags.noLan) {
      const lan = await scanLanTargets(deriveSubnet(), undefined, deps.scanFn);
      all = [...found, ...lan.found];
      reason = lan.skippedReason;
    }
    if (all.length === 0) {
      const result = setupResult({ ok: false, found: all, reason: reason ?? "no local server found — run interactive `ra setup` to configure cloud/manual" });
      log(JSON.stringify(result, null, 2));
      return { result, code: 1 };
    }
    const pick = pickDefaults(all, {
      small_model: flags.rescan ? undefined : cfg?.small_model,
      model: flags.rescan ? undefined : cfg?.model,
      currentSmallOk: flags.rescan ? false : currentSmallOk,
      currentBigOk: flags.rescan ? false : currentBigOk,
    });
    const { configPath } = saveSetupChoice({ root, found: all, small: pick.small, big: pick.big });
    const result = setupResult({ ok: true, configPath, small: pick.small, big: pick.big, found: all });
    log(JSON.stringify(result, null, 2));
    return { result, code: 0 };
  }

  // Interactive text flow (no TTY wizard — that lives in the TUI overlay).
  log(`RA setup — looking for model servers…`);
  const t0 = now();
  const { targets, found } = await scanLocalTargets(env, deps.scanFn);
  for (const t of targets) {
    const hit = found.find((f) => f.host === t.host && f.port === t.port);
    log(hit
      ? `${mark(true)} ${t.host}:${t.port}  ${hit.name}  ${hit.models.length} models  ${hit.ms}ms`
      : `${mark(false)} ${t.host}:${t.port}  ${t.label} — not running`);
  }
  let all = found;
  if (!flags.noLan) {
    const subnet = deriveSubnet();
    if (subnet) {
      log(`${ascii ? "*" : "◉"} Scanning ${subnet} … (esc-safe; ~10s budget)`);
      const lan = await scanLanTargets(subnet, (line) => log(`  ${line}`), deps.scanFn);
      all = [...found, ...lan.found];
      if (lan.skippedReason) log(`  ${lan.skippedReason}`);
    } else {
      log(`No local network interface found — LAN scan skipped.`);
    }
  }
  log(setupSummary(all, {}));
  if (all.length === 0) {
    log(`${mark(false)} No local server found — run interactive \`ra setup\` in a terminal for the cloud / manual URL path.`);
    const result = setupResult({ ok: false, found: [], reason: "no local server found" });
    return { result, code: 1 };
  }
  const pick = pickDefaults(all, {
    small_model: flags.rescan ? undefined : cfg?.small_model,
    model: flags.rescan ? undefined : cfg?.model,
    currentSmallOk: flags.rescan ? false : currentSmallOk,
    currentBigOk: flags.rescan ? false : currentBigOk,
  });
  const saved = saveSetupChoice({ root, found: all, small: pick.small, big: pick.big });
  log(`${mark(true)} saved → ${saved.configPath}  (${(now() - t0) / 1000 < 1 ? "<1" : ((now() - t0) / 1000).toFixed(1)}s)`);
  log(setupSummary(all, { small: pick.small, big: pick.big }));
  const result = setupResult({ ok: true, configPath: saved.configPath, small: pick.small, big: pick.big, found: all });
  return { result, code: 0 };
}

/** Base URL for a `provider/model` lane: configured provider baseURL, else the
 *  standard localhost / cloud endpoints. Used to ping existing lanes. */
export function providerUrlForLane(env: Record<string, string | undefined>, lane: string): string {
  const [provider] = lane.split("/");
  const known: Record<string, string> = {
    "ollama-lan": env.OLLAMA_LAN_URL ?? "http://localhost:11434",
    "ollama": env.OLLAMA_LOCAL_URL ?? "http://localhost:11434",
    "lmstudio": env.LM_STUDIO_URL ?? "http://localhost:1234",
    "llamacpp": env.LLAMACPP_URL ?? "http://localhost:8080",
    "ollama-cloud": env.OLLAMA_BASE_URL ?? "https://ollama.com",
  };
  return known[provider] ?? "http://localhost:11434";
}

export type { SetupFound };
