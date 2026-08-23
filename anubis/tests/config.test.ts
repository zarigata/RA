import { describe, expect, test } from "bun:test";
import { loadRaConfig, ensureRaDirs, applyEnvOverrides } from "../src/config.ts";
import { join, dirname } from "node:path";
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
});
