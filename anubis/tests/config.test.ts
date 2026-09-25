import { describe, expect, test } from "bun:test";
import { loadRaConfig, ensureRaDirs, applyEnvOverrides, applyProfile, applyProjectOverride } from "../src/config.ts";
import { join, dirname } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("ra config", () => {
  test("loads ra.json with mac-weak profile", () => {
    const cfg = loadRaConfig(root);
    expect(cfg.profile).toBe("mac-weak");
    expect(cfg.profiles?.["mac-weak"]).toBeDefined();
  });

  test("ensureRaDirs creates global dirs", () => {
    expect(() => ensureRaDirs()).not.toThrow();
  });
});

describe("env overrides", () => {
  const base = loadRaConfig(root);

  test("no env vars → unchanged", () => {
    const out = applyEnvOverrides(base, {});
    expect(out.model).toBe(base.model);
    expect(out.small_model).toBe(base.small_model);
  });

  test("RA_MODEL overrides BIG model", () => {
    const out = applyEnvOverrides(base, { RA_MODEL: "ollama-cloud/deepseek-v4-pro" });
    expect(out.model).toBe("ollama-cloud/deepseek-v4-pro");
    expect(out.small_model).toBe(base.small_model);
  });

  test("RA_SMALL_MODEL overrides small model", () => {
    const out = applyEnvOverrides(base, { RA_SMALL_MODEL: "ollama/gemma:latest" });
    expect(out.small_model).toBe("ollama/gemma:latest");
    expect(out.model).toBe(base.model);
  });

  test("ANUBIS_MODEL works as fallback name", () => {
    const out = applyEnvOverrides(base, { ANUBIS_MODEL: "ollama-cloud/glm-5.2" });
    expect(out.model).toBe("ollama-cloud/glm-5.2");
  });

  test("RA_* wins over ANUBIS_*", () => {
    const out = applyEnvOverrides(base, {
      RA_MODEL: "ollama-cloud/ra-wins",
      ANUBIS_MODEL: "ollama-cloud/anubis-loses",
    });
    expect(out.model).toBe("ollama-cloud/ra-wins");
  });

  test("RA_PROFILE selects a named profile before model overrides", () => {
    const cfg = {
      ...base,
      profiles: {
        ...(base.profiles ?? {}),
        cloud: {
          small_model: "openai/gpt-small",
          model: "openai/gpt-medium",
          tier_models: { meta: "openai/gpt-small", code: "openai/gpt-medium" },
          capability_router: { enabled: false },
        },
      },
    };
    const out = applyEnvOverrides(cfg, { RA_PROFILE: "cloud", RA_MODEL: "openai/gpt-override" });
    expect(out.profile).toBe("cloud");
    expect(out.small_model).toBe("openai/gpt-small");
    expect(out.model).toBe("openai/gpt-override");
    expect(out.tier_models?.meta).toBe("openai/gpt-small");
    expect(out.tier_models?.code).toBe("openai/gpt-override");
    expect(out.capability_router?.enabled).toBe(false);
  });
});

describe("profiles and project overrides", () => {
  test("applyProfile merges nested routing without losing global provider config", () => {
    const cfg = {
      model: "base/model",
      agent: { thoth: { model: "base/small" } },
      provider: { base: { options: { baseURL: "https://base.example/v1" } } },
      routing: { mode: "local-first" as const, escalate_threshold: 2 },
      profiles: {
        cloud: {
          model: "openai/medium",
          provider: { openai: { options: { baseURL: "https://api.openai.com/v1" } } },
          routing: { mode: "quality-first" as const },
          agent: { ptah: { model: "openai/medium" } },
        },
      },
    };
    const out = applyProfile(cfg, "cloud");
    expect(out.model).toBe("openai/medium");
    expect(out.provider?.base).toBeDefined();
    expect(out.provider?.openai).toBeDefined();
    expect(out.routing).toEqual({ mode: "quality-first", escalate_threshold: 2 });
    expect(out.agent?.thoth?.model).toBe("base/small");
    expect(out.agent?.ptah?.model).toBe("openai/medium");
  });

  test("project profile can select cloud routing without machine-local models", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-project-profile-"));
    try {
      mkdirSync(join(cwd, ".ra"), { recursive: true });
      writeFileSync(join(cwd, ".ra", "project.json"), JSON.stringify({
        profile: "cloud",
        budget: { session_usd: 2 },
      }));
      const cfg = {
        model: "ollama/local",
        small_model: "ollama/local-small",
        profiles: {
          cloud: {
            model: "openai/medium",
            small_model: "openai/small",
            tier_models: { meta: "openai/small", light: "openai/small", heavy: "openai/medium", code: "openai/medium" },
            capability_router: { enabled: false },
          },
        },
      };
      const out = applyProjectOverride(cfg, cwd);
      expect(out.profile).toBe("cloud");
      expect(out.model).toBe("openai/medium");
      expect(out.small_model).toBe("openai/small");
      expect(out.tier_models?.code).toBe("openai/medium");
      expect(out.capability_router?.enabled).toBe(false);
      expect(out.budget?.session_usd).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});
