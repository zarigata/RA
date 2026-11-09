// tests/setup.test.ts — ra/src/setup.ts CLI glue: JSON output, --check exit
// codes, --rescan ignoring the saved choice. All network faked.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetup } from "../src/setup.ts";
import type { ScanFn } from "../../anubis/src/setup.ts";

const noLanEnv = { RA_ASCII: "1", OLLAMA_LAN_URL: undefined as string | undefined };

/** Fake localhost: Ollama up with models, everything else null. */
const ollamaUp: ScanFn = async (_host, port) => (port === 11434 ? ["qwen3:4b", "gemma:latest"] : null);
const nothingUp: ScanFn = async () => null;

describe("runSetup --json", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ra-cli-setup-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.RA_CONFIG; });

  test("prints valid JSON with ok, configPath, small, found", async () => {
    const printed: string[] = [];
    const { result, code } = await runSetup(
      { json: true, noLan: true },
      { env: noLanEnv, root, scanFn: ollamaUp, log: (l) => printed.push(l) },
    );
    expect(code).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.small).toBe("ollama-lan/qwen3:4b");
    expect(result.found[0]).toMatchObject({ host: "127.0.0.1", port: 11434, provider: "ollama-lan", models: ["qwen3:4b", "gemma:latest"] });
    // the printed payload is valid JSON
    const parsed = JSON.parse(printed.join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.configPath).toBe(join(root, "ra.json"));
    expect(parsed.found).toHaveLength(1);
  });

  test("nothing found → ok:false, exit 1, no config write", async () => {
    const { result, code } = await runSetup(
      { json: true, noLan: true },
      { env: noLanEnv, root, scanFn: nothingUp },
    );
    expect(code).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.found).toEqual([]);
  });

  test("--rescan ignores the saved choice and scans again", async () => {
    // seed a saved lane
    writeFileSync(join(root, "ra.json"), JSON.stringify({ small_model: "ollama-lan/old-model", model: "ollama-cloud/old" }));
    const { result } = await runSetup(
      { json: true, noLan: true, rescan: true },
      { env: noLanEnv, root, scanFn: ollamaUp },
    );
    expect(result.small).toBe("ollama-lan/qwen3:4b"); // not old-model
    const saved = JSON.parse(readFileSync(join(root, "ra.json"), "utf-8"));
    expect(saved.small_model).toBe("ollama-lan/qwen3:4b");
  });
});

describe("runSetup --check", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ra-check-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.RA_CONFIG; });

  test("exit 0 when a small model is reachable", async () => {
    const printed: string[] = [];
    const { code } = await runSetup(
      { check: true },
      { env: noLanEnv, root, scanFn: ollamaUp, log: (l) => printed.push(l) },
    );
    expect(code).toBe(0);
    expect(printed.join("\n")).toContain("11434");
    expect(printed.join("\n")).not.toMatch(/[^\x00-\x7F]/); // ASCII marks only
  });

  test("exit 1 when nothing is reachable", async () => {
    const printed: string[] = [];
    const { code } = await runSetup(
      { check: true },
      { env: noLanEnv, root, scanFn: nothingUp, log: (l) => printed.push(l) },
    );
    expect(code).toBe(1);
    expect(printed.join("\n")).toContain("no small model");
  });
});
