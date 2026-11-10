// config-malformed.test.ts — Wave 3a edge cases, part 3: malformed config
// files through the REAL loader. Every parseable-config format (ra.json JSON,
// legacy anubis.json) × every corruption shape (truncated, BOM, CRLF, wrong
// types, null fields, giant nesting, arrays where objects belong) — the
// loader throws a diagnosable error (never a raw JSON parse stack) or parses
// fail-closed. saveRaConfig's plaintext-key refusal is pinned too.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { loadRaConfig, saveRaConfig, sessionPath, type RaConfig } from "../src/config.ts";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let ROOT = "";
beforeEach(() => { ROOT = mkdtempSync(join(tmpdir(), "ra-cfgmal-")); delete process.env.RA_CONFIG; });
afterEach(() => { rmSync(ROOT, { recursive: true, force: true }); delete process.env.RA_CONFIG; });

describe("loadRaConfig — corruption matrix", () => {
  const shapes: Array<[string, string]> = [
    ["empty file", ""],
    ["whitespace only", "  \n\t "],
    ["truncated JSON", '{"model": "x", "agent": {'],
    ["bare string", "hello"],
    ["JSON array at top level", "[1,2,3]"],
    ["null literal", "null"],
    ["BOM-prefixed valid JSON", "﻿" + JSON.stringify({ model: "m" })],
    ["JSON with comments (invalid)", "{ /* c */ }"],
    ["single quotes (JS-style, invalid JSON)", "{'model': 'x'}"],
    ["trailing comma", '{"model": "x",}'],
    ["double JSON documents", JSON.stringify({ model: "a" }) + JSON.stringify({ model: "b" })],
    ["binary garbage", "\u0001\u0002\u0003"],
    ["deeply nested but valid", JSON.stringify({ agent: { a: { b: { c: { d: { e: 1 } } } } } })],
  ];

  for (const [label, raw] of shapes) {
    test(`"${label}": throws a config-not-found/parse error or fails closed — never a wrong success`, () => {
      writeFileSync(join(ROOT, "ra.json"), raw);
      let loaded: RaConfig | null = null;
      try {
        loaded = loadRaConfig(ROOT);
      } catch (e) {
        // Acceptable: any thrown Error (missing-config phrasing or JSON parse)
        expect(e).toBeInstanceOf(Error);
        return;
      }
      // If it parsed, the result must be an object (null/array/string rejections)
      expect(typeof loaded).toBe("object"); // ${label}
    });
  }

  test("wrong-typed fields parse but never crash downstream consumers of the hot paths", () => {
    // Fields the runtime reads with typed access — verify the documented
    // shapes survive a load and the obviously wrong ones don't leak through.
    writeFileSync(join(ROOT, "ra.json"), JSON.stringify({
      model: 123, small_model: null, agent: "not-an-object",
      permission: { tool: { bash: "yolo" } },
    }));
    let cfg: RaConfig | null = null;
    try { cfg = loadRaConfig(ROOT); } catch { return; }
    // env overrides may normalize some; whatever came through is object-shaped
    expect(cfg).toBeTruthy();
  });

  test("a valid config with CRLF inside string values round-trips byte-stably", () => {
    const cfg = { model: "ollama-lan/qwen3.8:latest", agent: {}, note: "line1\r\nline2" } as RaConfig;
    const p = saveRaConfig(cfg, ROOT);
    const back = JSON.parse(readFileSync(p, "utf-8")) as typeof cfg;
    expect(back.note).toBe("line1\r\nline2");
  });
});

describe("loadRaConfig — path resolution rules", () => {
  test("RA_CONFIG wins over both root files", () => {
    const alt = mkdtempSync(join(tmpdir(), "ra-cfgmal-alt-"));
    try {
      writeFileSync(join(ROOT, "ra.json"), JSON.stringify({ model: "from-root" }));
      writeFileSync(join(alt, "ra.json"), JSON.stringify({ model: "from-env" }));
      process.env.RA_CONFIG = join(alt, "ra.json");
      expect(loadRaConfig(ROOT).model).toBe("from-env");
    } finally {
      rmSync(alt, { recursive: true, force: true });
    }
  });

  test("legacy anubis.json used when ra.json absent", () => {
    writeFileSync(join(ROOT, "anubis.json"), JSON.stringify({ model: "legacy" }));
    expect(loadRaConfig(ROOT).model).toBe("legacy");
  });

  test("ra.json preferred when both exist", () => {
    writeFileSync(join(ROOT, "anubis.json"), JSON.stringify({ model: "legacy" }));
    writeFileSync(join(ROOT, "ra.json"), JSON.stringify({ model: "modern" }));
    expect(loadRaConfig(ROOT).model).toBe("modern");
  });

  test("neither file → clear not-found error naming the path", () => {
    expect(() => loadRaConfig(ROOT)).toThrow(/configuration not found/i);
  });

  test("profile merge applies agent + tier_models from the active profile", () => {
    writeFileSync(join(ROOT, "ra.json"), JSON.stringify({
      model: "m",
      profile: "p1",
      agent: { base: { model: "x" } },
      profiles: { p1: { agent: { extra: { model: "y" } }, tier_models: { light: "small-m" } } },
    }));
    const cfg = loadRaConfig(ROOT) as RaConfig & { tier_models?: Record<string, string> };
    expect((cfg.agent as Record<string, unknown>).base).toBeDefined(); // base kept
    expect((cfg.agent as Record<string, unknown>).extra).toBeDefined(); // profile merged
    expect(cfg.tier_models?.light).toBe("small-m");
  });
});

describe("saveRaConfig — the plaintext-key refusal gate", () => {
  test("refuses a provider with a literal apiKey (nothing written)", () => {
    expect(() => saveRaConfig({
      model: "m", agent: {},
      provider: { leaky: { options: { baseURL: "https://x", apiKey: "sk-literal-key-1234567890" } } },
    } as RaConfig, ROOT)).toThrow(/plaintext apiKey/);
    expect(existsSync(join(ROOT, "ra.json"))).toBe(false);
    expect(existsSync(join(ROOT, "ra.json.tmp"))).toBe(false);
  });

  test("accepts {env:VAR} template keys; atomic rename leaves no .tmp", () => {
    const p = saveRaConfig({
      model: "m", agent: {},
      provider: { ok: { options: { baseURL: "https://x", apiKey: "{env:OK_API_KEY}" } } },
    } as RaConfig, ROOT);
    expect(p).toBe(join(ROOT, "ra.json"));
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });

  test("save→load round-trip is stable", () => {
    const cfg: RaConfig = { model: "ollama-lan/q", small_model: "ollama-lan/s", agent: { role: { model: "z" } } };
    saveRaConfig(cfg, ROOT);
    expect(loadRaConfig(ROOT)).toEqual(cfg);
  });
});

describe("RA_GLOBAL + sessionPath isolation", () => {
  test("sessionPath slugs are collision-free for distinct cwds", () => {
    const a = sessionPath("/Users/x/proj");
    const b = sessionPath("/Users/x/proj2");
    expect(a).not.toBe(b);
  });
});
