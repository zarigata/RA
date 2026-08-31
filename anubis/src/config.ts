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
  moa?: { roles: string[]; parallel: boolean; concurrency?: number };
  agent_limits?: { max_calls?: number; max_agents?: number; max_depth?: number; timeout_ms?: number };
  sandbox?: { mode?: "workspace-write" | "read-only" | "off"; network?: "deny" | "allow" };
  pipeline?: { stages: string[] };
  permission?: {
    tool?: Record<string, "allow" | "ask" | "deny">;
    skill?: Record<string, "allow" | "ask" | "deny">;
  };
  mcp?: Record<string, { command: string; args?: string[]; env?: Record<string, string> } | { url: string; headers?: Record<string, string> }>;
  /** Air-gapped mode: 100% local operation, no cloud providers, no external fetches. */
  airgap?: boolean;
  /**
   * Explicit model fallback chains, tried in order when the primary model
   * fails on a provider error. Candidates must be the same host kind as the
   * primary (a cloud model never silently falls back to a local model).
   * Auth failures and user cancellations never trigger a fallback.
   */
  fallbacks?: { default?: string[]; models?: Record<string, string[]> };
  /** UI theme/palette name (maps to a ColorPalette in ui.ts). */
  theme?: string;
  /** Keybind overrides: maps key combo (e.g. "ctrl+p") to a command or action. */
  keybinds?: Record<string, string>;
}

export function ensureRaDirs(): void {
  for (const d of [RA_GLOBAL, join(RA_GLOBAL, "sessions"), join(RA_GLOBAL, "benchmarks")]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function loadRaConfig(root = RA_HOME): RaConfig {
  const raPath = process.env.RA_CONFIG ?? join(root, "ra.json");
  const legacyPath = join(root, "anubis.json");
  const path = (process.env.RA_CONFIG || existsSync(raPath)) ? raPath : legacyPath;
  if (!existsSync(path)) throw new Error(`RA configuration not found: ${path}`);
  const cfg = JSON.parse(readFileSync(path, "utf-8")) as RaConfig;

  if (cfg.profile && cfg.profiles?.[cfg.profile]) {
    const p = cfg.profiles[cfg.profile];
    if (p.agent) cfg.agent = { ...cfg.agent, ...p.agent };
    if (p.tier_models) (cfg as RaConfig & { tier_models?: Record<string, string> }).tier_models = p.tier_models;
  }
  return applyEnvOverrides(cfg);
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
  const fbBig = (env.RA_FALLBACK ?? env.ANUBIS_FALLBACK)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const fbSmall = (env.RA_SMALL_FALLBACK ?? env.ANUBIS_SMALL_FALLBACK)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (!big && !small && fbBig.length === 0 && fbSmall.length === 0) return cfg;
  const out: RaConfig = { ...cfg };
  if (big) out.model = big;
  if (small) out.small_model = small;
  if (fbBig.length > 0 || fbSmall.length > 0) {
    const models = { ...out.fallbacks?.models };
    if (big && fbBig.length > 0) models[big] = fbBig;
    if (small && fbSmall.length > 0) models[small] = fbSmall;
    out.fallbacks = { ...out.fallbacks, models };
  }
  out.agent = Object.fromEntries(Object.entries(cfg.agent ?? {}).map(([role, agent]) => {
    const model = role === "ptah" || role === "general" ? big : small;
    return [role, model ? { ...agent, model } : agent];
  }));
  const tiers = (cfg as RaConfig & { tier_models?: Record<string, string> }).tier_models;
  if (tiers) (out as RaConfig & { tier_models?: Record<string, string> }).tier_models = {
    ...tiers,
    ...(big ? { code: big, heavy: big } : {}),
    ...(small ? { meta: small, light: small } : {}),
  };
  return out;
}
