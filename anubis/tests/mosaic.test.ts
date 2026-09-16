// tests/mosaic.test.ts — Provider Mosaic (ra.77): capability profiles,
// benchmark-driven ranking with the local bonus, quota cooldowns, and the
// capability router (key/quota filtering, failover chains).

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  profileFor,
  scoreModel,
  rankForJob,
  jobForRole,
  formatProfile,
  DEFAULT_PROFILE,
} from "../src/profiles.ts";
import {
  isQuotaError,
  markExhausted,
  isExhausted,
  exhaustedUntil,
  clearExhausted,
  quotaHealth,
  formatQuota,
  quotaKey,
} from "../src/quota.ts";
import { candidateModels, pickForJob, formatProviders } from "../src/capability.ts";
import type { RaConfig } from "../src/config.ts";
import { rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

describe("capability profiles (2026-09 benchmark snapshot)", () => {
  test("frontier coders score highest on code", () => {
    expect(scoreModel("openai/gpt-5.6-sol", "code")).toBe(10);
    expect(scoreModel("anthropic/claude-fable-5", "code")).toBe(9.5);
    expect(scoreModel("zai/glm-5.2", "code")).toBe(8.5);
  });

  test("gemini is the researcher; deepseek is the open all-rounder", () => {
    expect(scoreModel("google/gemini-3-pro", "research")).toBe(10);
    expect(scoreModel("deepseek-v4-pro", "research")).toBeGreaterThan(scoreModel("gemma:latest", "research"));
    expect(profileFor("google/gemini-2.5-pro").note).toContain("researcher");
  });

  test("unknown models fall back to the mid-tier default", () => {
    expect(profileFor("totally-unknown-model")).toBe(DEFAULT_PROFILE);
    expect(scoreModel("totally-unknown-model", "code")).toBe(5);
  });

  test("gpt-oss variants resolve to distinct profiles", () => {
    expect(scoreModel("gpt-oss:120b", "code")).toBeGreaterThan(scoreModel("gpt-oss:20b", "code"));
  });

  test("jobForRole maps roles and tiers onto jobs", () => {
    expect(jobForRole("ptah", "code")).toBe("code");
    expect(jobForRole("isis")).toBe("research");
    expect(jobForRole("maat")).toBe("review");
    expect(jobForRole("thoth", "heavy")).toBe("reasoning");
    expect(jobForRole("general", "light")).toBe("chat");
  });

  test("formatProfile renders a one-liner", () => {
    expect(formatProfile("google/gemini-3-pro")).toContain("gemini-3-pro");
    expect(formatProfile("google/gemini-3-pro")).toContain("research");
  });
});

describe("ranking with the local bonus", () => {
  const pool = ["ollama-lan/gpt-oss:20b", "ollama-cloud/glm-5.2"];

  test("default topology preserved: thoth stays local, ptah goes cloud", () => {
    // reasoning: local 6 + 2 = 8 vs cloud 8 → tie → local wins
    const reasoning = rankForJob(pool, "reasoning");
    expect(reasoning[0].model).toBe("ollama-lan/gpt-oss:20b");
    // code: local 6 + 2 = 8 vs cloud 8.5 → cloud specialist wins
    const code = rankForJob(pool, "code");
    expect(code[0].model).toBe("ollama-cloud/glm-5.2");
  });

  test("a research specialist beats the local bonus when clearly better", () => {
    const withGemini = [...pool, "google/gemini-3-pro"];
    expect(rankForJob(withGemini, "research")[0].model).toBe("google/gemini-3-pro");
  });

  test("bonus zero flips ties to name order; local still preferred on equal scores", () => {
    const ranked = rankForJob(pool, "reasoning", 0);
    expect(ranked[0].model).toBe("ollama-cloud/glm-5.2"); // 8 vs 6, no bonus
  });
});

describe("quota tracking", () => {
  const storePath = join(tmpdir(), "ra-mosaic-quota", "quota.json");
  beforeAll(() => {
    mkdirSync(dirname(storePath), { recursive: true });
    rmSync(storePath, { force: true });
    process.env.RA_QUOTA_PATH = storePath;
  });
  afterAll(() => {
    delete process.env.RA_QUOTA_PATH;
    rmSync(dirname(storePath), { recursive: true, force: true });
  });

  test("quota errors are distinct from auth errors", () => {
    expect(isQuotaError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isQuotaError(new Error("rate limit exceeded"))).toBe(true);
    expect(isQuotaError(new Error("insufficient_quota: billing"))).toBe(true);
    expect(isQuotaError(new Error("401 unauthorized: invalid api key"))).toBe(false);
    expect(isQuotaError(new Error("403 forbidden"))).toBe(false);
  });

  test("provider-prefixed keys map to the provider", () => {
    expect(quotaKey("google/gemini-3-pro")).toBe("google");
    expect(quotaKey("gemma:latest")).toBe("gemma:latest");
  });

  test("mark → exhausted → cooldown expiry → clear", () => {
    const now = Date.now();
    markExhausted("google/gemini-3-pro", "429 rate limit", now + 60_000);
    expect(isExhausted("google", now)).toBe(true);
    expect(isExhausted("google/gemini-3-pro", now + 61_000)).toBe(false); // expired reads clean up
    // A fresh window starts at hits 1 (the expired entry was reaped);
    // a second hit inside the SAME window accumulates.
    markExhausted("google", "429 again", now + 120_000);
    markExhausted("google/gemini-3-pro", "429 third", now + 120_000);
    const health = quotaHealth(now);
    expect(health.length).toBe(1);
    expect(health[0].provider).toBe("google");
    expect(health[0].hits).toBe(2);
    expect(formatQuota(now)).toContain("google");
    clearExhausted("google");
    expect(quotaHealth(now).length).toBe(0);
  });
});

describe("capability router", () => {
  const env = { OLLAMA_API_KEY: "k", GOOGLE_API_KEY: "g" };
  const config: RaConfig = {
    model: "ollama-cloud/glm-5.2",
    small_model: "ollama-lan/gpt-oss:20b",
    agent: {},
    provider: {
      "ollama-cloud": { options: { baseURL: "https://ollama.com/v1", apiKey: "{env:OLLAMA_API_KEY}" }, models: { "glm-5.2": {} } },
      "ollama-lan": { options: { baseURL: "http://192.168.1.251:11434/v1" }, models: { "gpt-oss:20b": {} } },
      google: { options: { baseURL: "https://generativelanguage.googleapis.com/v1beta", apiKey: "{env:GOOGLE_API_KEY}" }, models: { "gemini-3-pro": {} } },
      zai: { options: { baseURL: "https://api.z.ai/api/paas/v4", apiKey: "{env:ZAI_API_KEY}" }, models: { "glm-5.2": {} } },
    },
    capability_router: { enabled: true, local_bonus: 2, max_candidates: 2, models: ["*"] },
  };

  test("candidateModels enumerates lanes + provider blocks with key presence", () => {
    const candidates = candidateModels(config, env);
    const models = candidates.map((c) => c.model);
    expect(models).toContain("ollama-lan/gpt-oss:20b");
    expect(models).toContain("google/gemini-3-pro");
    expect(models).toContain("zai/glm-5.2");
    const zai = candidates.find((c) => c.provider === "zai")!;
    expect(zai.kind).toBe("cloud");
    expect(zai.hasKey).toBe(false); // ZAI_API_KEY not set
    expect(candidates.find((c) => c.provider === "google")!.hasKey).toBe(true);
  });

  test("research job routes to gemini; code to the cloud specialist", () => {
    const research = pickForJob("research", config, env)!;
    expect(research.primary.model).toBe("google/gemini-3-pro");
    const code = pickForJob("code", config, env)!;
    expect(code.primary.local).toBe(false);
    expect(["ollama-cloud/glm-5.2", "google/gemini-3-pro"]).toContain(code.primary.model);
  });

  test("keyless cloud providers are skipped and reported", () => {
    const routing = pickForJob("code", config, env)!;
    expect(routing.skipped.some((s) => s.model === "zai/glm-5.2" && s.reason.includes("no api key"))).toBe(true);
  });

  test("exhausted providers drop out and failover reroutes", () => {
    const now = Date.now();
    markExhausted("google", "429 rate limit", now + 60_000);
    const research = pickForJob("research", config, env, now)!;
    expect(research.primary.model).not.toContain("google");
    expect(research.skipped.some((s) => s.model === "google/gemini-3-pro" && s.reason.includes("quota"))).toBe(true);
    clearExhausted("google");
  });

  test("failover chain respects max_candidates and excludes the primary", () => {
    const routing = pickForJob("code", config, env)!;
    expect(routing.chain.length).toBeLessThanOrEqual(2);
    expect(routing.chain).not.toContain(routing.primary.model);
  });

  test("router can be disabled by config", () => {
    const off = pickForJob("code", { ...config, capability_router: { enabled: false } }, env)!;
    expect(off.primary).toBeTruthy(); // ranking still computable; the agent skips it when disabled
  });

  test("no allowlist = full-auto mosaic: every configured provider joins the pool", () => {
    const auto = pickForJob("research", { ...config, capability_router: { enabled: true } }, env)!;
    expect(auto.primary.model).toBe("google/gemini-3-pro"); // logged providers are used automatically
    // an explicit allowlist constrains back to the lanes
    const constrained = pickForJob("research", { ...config, capability_router: { enabled: true, models: [] } }, env)!;
    expect(["ollama-lan/gpt-oss:20b", "ollama-cloud/glm-5.2"]).toContain(constrained.primary.model);
  });

  test("allowlist entries opt specialists in; provider/* prefixes match families", () => {
    const optIn = pickForJob("research", { ...config, capability_router: { enabled: true, models: ["google/*"] } }, env)!;
    expect(optIn.primary.model).toBe("google/gemini-3-pro");
    const lmOnly = pickForJob("chat", { ...config, capability_router: { enabled: true, models: ["lmstudio/*"] }, provider: { ...config.provider, lmstudio: { options: { baseURL: "http://localhost:1234/v1" }, models: { "qwen3-30b": {} } } } }, env)!;
    expect(lmOnly.primary.model).toBe("lmstudio/qwen3-30b");
    expect(lmOnly.primary.local).toBe(true);
  });

  test("formatProviders renders state for /providers", () => {
    const text = formatProviders(config, env);
    expect(text).toContain("capability router on (local_bonus 2)");
    expect(text).toContain("google/gemini-3-pro");
    expect(text).toContain("no api key (skipped)");
  });
});
