import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyProjectOverride, loadProjectOverride, loadRaConfig } from "../src/config.ts";
import { formatRaEnv } from "../src/ra-env.ts";

describe("project override", () => {
  test("loads .ra/project.json small/big", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-proj-"));
    try {
      mkdirSync(join(cwd, ".ra"));
      writeFileSync(
        join(cwd, ".ra", "project.json"),
        JSON.stringify({ small: "ollama-lan/qwen3.8:latest", big: "ollama-cloud/glm-5.2" }),
      );
      const o = loadProjectOverride(cwd);
      expect(o?.small_model).toBe("ollama-lan/qwen3.8:latest");
      expect(o?.model).toBe("ollama-cloud/glm-5.2");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  test("applyProjectOverride merges onto config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "ra-proj-"));
    try {
      mkdirSync(join(cwd, ".ra"));
      writeFileSync(join(cwd, ".ra", "project.json"), JSON.stringify({ small: "ollama/gemma:latest" }));
      const root = join(import.meta.dir, "..");
      const cfg = applyProjectOverride(loadRaConfig(root), cwd);
      expect(cfg.small_model).toBe("ollama/gemma:latest");
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });
});

describe("formatRaEnv", () => {
  test("masks keys and shows .251 defaults", () => {
    const text = formatRaEnv({
      OLLAMA_LAN_URL: "http://192.168.1.251:11434",
      OLLAMA_LOCAL_URL: "http://localhost:11434",
      OLLAMA_API_KEY: "650bd857ac004b12921a525b89f484f2.secret",
    });
    expect(text).toContain("RA env");
    expect(text).toContain("192.168.1.251");
    expect(text).toContain("localhost");
    expect(text).not.toContain("secret");
    expect(text).toContain("…");
  });
});
