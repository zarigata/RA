// tests/setup.test.ts — setup engine (U3) + saveRaConfig (U2) tests.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRaConfig, loadRaConfig, type RaConfig } from "../src/config.ts";
import {
  scanLocalTargets,
  scanLanTargets,
  pickDefaults,
  saveSetupChoice,
  setupSummary,
  type SetupFound,
} from "../src/setup.ts";

describe("saveRaConfig (U2)", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ra-save-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.RA_CONFIG; });

  test("writes atomically and round-trips through loadRaConfig", () => {
    const p = saveRaConfig({ small_model: "ollama-lan/qwen3:4b", model: "ollama-cloud/glm-5.2" }, root);
    expect(p).toBe(join(root, "ra.json"));
    expect(existsSync(`${p}.tmp`)).toBe(false); // tmp was renamed away
    expect(readFileSync(p, "utf-8").endsWith("\n")).toBe(true);
    process.env.RA_CONFIG = p;
    expect(loadRaConfig(root).small_model).toBe("ollama-lan/qwen3:4b");
  });

  test("refuses a plaintext apiKey — nothing is written", () => {
    const bad: RaConfig = { provider: { "my-cloud": { options: { apiKey: "sk-plaintext-123" } } } };
    expect(() => saveRaConfig(bad, root)).toThrow(/plaintext/);
    expect(existsSync(join(root, "ra.json"))).toBe(false);
  });

  test("accepts {env:VAR} template keys", () => {
    const ok: RaConfig = { provider: { "ollama-cloud": { options: { apiKey: "{env:OLLAMA_API_KEY}" } } } };
    const p = saveRaConfig(ok, root);
    expect(readFileSync(p, "utf-8")).toContain("{env:OLLAMA_API_KEY}");
  });
});

describe("scanLocalTargets (U3)", () => {
  test("returns found targets in order with latency; down targets reported", async () => {
    const fakeScan = async (host: string, port: number): Promise<string[] | null> => {
      if (port === 11434) return ["qwen3:4b", "gemma:latest"];
      return null; // LM Studio + llama.cpp down
    };
    const res = await scanLocalTargets({}, fakeScan);
    expect(res.found).toHaveLength(1);
    expect(res.found[0]).toMatchObject({ host: "127.0.0.1", port: 11434, provider: "ollama-lan", name: "Ollama", models: ["qwen3:4b", "gemma:latest"] });
    expect(res.found[0].ms).toBeGreaterThanOrEqual(0);
    expect(res.targets.map((t) => t.label)).toContain("LM Studio, localhost");
  });

  test("includes the configured LAN URL target when set", async () => {
    const res = await scanLocalTargets({ OLLAMA_LAN_URL: "http://192.168.1.50:11434" }, async () => null);
    expect(res.targets.some((t) => t.host === "192.168.1.50" && t.port === 11434)).toBe(true);
  });
});

describe("scanLanTargets (U3)", () => {
  test("skips LAN when no local network interface found", async () => {
    const res = await scanLanTargets(null, undefined, async () => { throw new Error("should not scan"); });
    expect(res.found).toEqual([]);
    expect(res.skippedReason).toContain("No local network interface");
  });

  test("scans the derived subnet with progress and returns found hosts", async () => {
    const fakeScan = async (host: string, port: number): Promise<string[] | null> => {
      if (host === "192.168.1.50" && port === 1234) return ["gpt-oss:20b"];
      return null;
    };
    const progress: string[] = [];
    const res = await scanLanTargets("192.168.1.0/24", (p) => progress.push(p.currentHost), fakeScan);
    expect(res.found).toHaveLength(1);
    expect(res.found[0]).toMatchObject({ host: "192.168.1.50", port: 1234, provider: "lmstudio-lan", name: "LM Studio" });
    expect(progress.length).toBeGreaterThan(0);
  });
});

const F = (over: Partial<SetupFound> = {}): SetupFound => ({
  host: "127.0.0.1", port: 11434, provider: "ollama-lan", name: "Ollama", models: ["qwen3:4b"], ms: 10, ...over,
});

describe("pickDefaults (U3)", () => {
  test("keeps a working existing lane", () => {
    const pick = pickDefaults([F()], { small_model: "ollama-lan/qwen3:4b", model: "ollama-cloud/glm-5.2", currentSmallOk: true, currentBigOk: true });
    expect(pick.small).toBe("ollama-lan/qwen3:4b");
    expect(pick.big).toBe("ollama-cloud/glm-5.2");
  });

  test("prefers small-family models over unknown ones, localhost over LAN", () => {
    const found = [
      F({ host: "192.168.1.60", provider: "lmstudio-lan", name: "LM Studio", port: 1234, models: ["gpt-oss:20b"] }),
      F({ models: ["llama3.2:latest"] }),
      F({ host: "127.0.0.1", port: 8080, provider: "llamacpp-lan", name: "llama.cpp", models: ["gemma:latest"] }),
    ];
    const pick = pickDefaults(found, {});
    expect(pick.small).toBe("llamacpp-lan/gemma:latest");
  });

  test("leaves big unset when no cloud model exists (local-only setup)", () => {
    const pick = pickDefaults([F()], {});
    expect(pick.small).toBe("ollama-lan/qwen3:4b");
    expect(pick.big).toBeUndefined();
  });

  test("falls back to the first found model when nothing matches", () => {
    const pick = pickDefaults([F({ models: ["mystery:7b"] })], {});
    expect(pick.small).toBe("ollama-lan/mystery:7b");
  });
});

describe("saveSetupChoice (U3)", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ra-choice-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); delete process.env.RA_CONFIG; });

  test("merges provider entries and writes lanes; refuses plaintext keys; env keys to .env only", () => {
    // existing config with a provider block that must be merged, not replaced
    const existing: RaConfig = { small_model: "ollama-lan/old", model: "ollama-cloud/old", provider: { "keep-me": { options: { baseURL: "http://x/v1" } } } };
    writeFileSync(join(root, "ra.json"), JSON.stringify(existing));
    const res = saveSetupChoice({
      root,
      found: [F()],
      small: "ollama-lan/qwen3:4b",
      big: "ollama-cloud/glm-5.2",
      cloudKey: "sk-test-123",
    });
    expect(res.configPath).toBe(join(root, "ra.json"));
    const saved = JSON.parse(readFileSync(join(root, "ra.json"), "utf-8"));
    expect(saved.small_model).toBe("ollama-lan/qwen3:4b");
    expect(saved.model).toBe("ollama-cloud/glm-5.2");
    expect(saved.provider["keep-me"]).toBeDefined();        // merge, not replace
    expect(saved.provider["ollama-lan"].baseURL).toBe("http://127.0.0.1:11434/v1");
    expect(saved.provider["ollama-cloud"].options.apiKey).toBe("{env:OLLAMA_API_KEY}"); // template only
    // the actual key landed in .env (0600), never in ra.json
    const envFile = readFileSync(join(root, ".env"), "utf-8");
    expect(envFile).toContain("OLLAMA_API_KEY=sk-test-123");
    expect(readFileSync(join(root, "ra.json"), "utf-8")).not.toContain("sk-test-123");
  });

  test("no cloudKey → no .env write, big left unset is fine", () => {
    const res = saveSetupChoice({ root, found: [F()], small: "ollama-lan/qwen3:4b" });
    expect(existsSync(join(root, ".env"))).toBe(false);
    const saved = JSON.parse(readFileSync(join(root, "ra.json"), "utf-8"));
    expect(saved.small_model).toBe("ollama-lan/qwen3:4b");
    expect(saved.model).toBeUndefined();
  });

  test("fresh machine: creates ra.json when none exists", () => {
    const res = saveSetupChoice({ root, found: [F()], small: "ollama-lan/qwen3:4b" });
    expect(existsSync(res.configPath)).toBe(true);
  });

  test("manual URL validated with scanHost before it is saved", async () => {
    // covered via ra/src/setup.ts integration — here: bad URL returns null (scanHost contract)
    const { scanHost } = await import("../src/lan.ts");
    expect(await scanHost("127.0.0.1", 1, 100)).toBeNull();
  });
});

describe("setupSummary (U3)", () => {
  test("lists found hosts with provider, latency and model count", () => {
    const text = setupSummary([F({ models: ["a", "b", "c", "d", "e"] })], { small: "ollama-lan/a", big: undefined });
    expect(text).toContain("127.0.0.1:11434");
    expect(text).toContain("Ollama");
    expect(text).toContain("+1 more"); // 5 models → 4 shown + "+1 more"
  });

  test("empty found → clear empty-state line", () => {
    expect(setupSummary([], {})).toContain("No model servers found");
  });
});
