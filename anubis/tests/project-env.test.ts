import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyProjectOverride, loadProjectOverride, loadRaConfig } from "../src/config.ts";
import { formatRaEnv } from "../src/ra-env.ts";

// RFC 5737 TEST-NET-1 documentation address — never a real host.
const LAN_URL = "http://192.0.2.50:11434";

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
  test("masks keys and shows the configured LAN URL", () => {
    const text = formatRaEnv({
      OLLAMA_LAN_URL: LAN_URL,
      OLLAMA_LOCAL_URL: "http://localhost:11434",
      OLLAMA_API_KEY: "test-key-id-1234567890abcdef.secret",
    });
    expect(text).toContain("RA env");
    expect(text).toContain(LAN_URL);
    expect(text).toContain("localhost");
    expect(text).not.toContain("secret");
    expect(text).toContain("…");
  });

  test("defaults to localhost when OLLAMA_LAN_URL is unset", () => {
    const text = formatRaEnv({});
    expect(text).toContain("OLLAMA_LAN_URL=http://localhost:11434");
  });
});
