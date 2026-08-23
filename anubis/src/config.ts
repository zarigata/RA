// src/config.ts — load ra.json with anubis.json fallback + profile merge

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { RouterConfig } from "./router.ts";

export const RA_HOME = process.env.RA_HOME ?? process.env.ANUBIS_HOME ?? process.cwd();
export const RA_GLOBAL = join(homedir(), ".ra");

export interface RaConfig extends RouterConfig {
  profile?: string;
  profiles?: Record<string, Partial<RaConfig> & { tier_models?: Record<string, string> }>;
  small_model?: string;
  provider?: Record<string, unknown>;
  plugin?: string[];
  moa?: { roles: string[]; parallel: boolean };
  pipeline?: { stages: string[] };
  permission?: {
    tool?: Record<string, "allow" | "ask" | "deny">;
    skill?: Record<string, "allow" | "ask" | "deny">;
  };
}

export function ensureRaDirs(): void {
  for (const d of [RA_GLOBAL, join(RA_GLOBAL, "sessions"), join(RA_GLOBAL, "benchmarks")]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function loadRaConfig(root = RA_HOME): RaConfig {
  const raPath = join(root, "ra.json");
  const legacyPath = join(root, "anubis.json");
  const path = existsSync(raPath) ? raPath : legacyPath;
  if (!existsSync(path)) throw new Error(`No ra.json or anubis.json in ${root}`);
  const cfg = JSON.parse(readFileSync(path, "utf-8")) as RaConfig;

  if (cfg.profile && cfg.profiles?.[cfg.profile]) {
    const p = cfg.profiles[cfg.profile];
    if (p.agent) cfg.agent = { ...cfg.agent, ...p.agent };
    if (p.tier_models) (cfg as RaConfig & { tier_models?: Record<string, string> }).tier_models = p.tier_models;
  }
  return cfg;
}

export function sessionPath(projectCwd: string): string {
  const slug = projectCwd.replace(/\//g, "_").replace(/^_|_$/g, "") || "default";
  return join(RA_GLOBAL, "sessions", `${slug}.json`);
}

/** Optional per-project overrides from cwd/.ra/project.json (written by `ra init`) */
export function loadProjectOverride(cwd: string): Partial<RaConfig> | null {
  const path = join(cwd, ".ra", "project.json");
  if (!existsSync(path)) return null;
  try {
    const j = JSON.parse(readFileSync(path, "utf-8")) as {
      small?: string;
      big?: string;
      name?: string;
    };
    const out: Partial<RaConfig> = {};
    if (j.big) out.model = j.big;
    if (j.small) out.small_model = j.small;
    return out;
  } catch {
    return null;
  }
}

export function applyProjectOverride(cfg: RaConfig, cwd: string): RaConfig {
  const o = loadProjectOverride(cwd);
  if (!o) return cfg;
  return { ...cfg, ...o };
}

/**
 * Env-var overrides for model config. Precedence (highest first):
 *   RA_MODEL / ANUBIS_MODEL        → cfg.model (BIG)
 *   RA_SMALL_MODEL / ANUBIS_SMALL_MODEL → cfg.small_model (small)
 * `RA_*` wins over `ANUBIS_*` when both are set.
 */
export function applyEnvOverrides(
  cfg: RaConfig,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): RaConfig {
  const big = env.RA_MODEL ?? env.ANUBIS_MODEL;
  const small = env.RA_SMALL_MODEL ?? env.ANUBIS_SMALL_MODEL;
  if (!big && !small) return cfg;
  const out: RaConfig = { ...cfg };
  if (big) out.model = big;
  if (small) out.small_model = small;
  return out;
}
