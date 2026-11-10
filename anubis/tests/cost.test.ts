import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  estimateCost,
  isFree,
  priceFor,
  buildReport,
  formatReport,
  sessionUsage,
  formatSessionUsage,
  setPriceOverrides,
  priceOverridesFromConfig,
  clearPriceOverrides,
  loadUsageJson,
  writeJsonAtomic,
} from "../src/cost.ts";

describe("cost estimation", () => {
  test("local ollama is free", () => {
    expect(isFree("ollama/gemma:latest")).toBe(true);
    expect(isFree("ollama-lan/gpt-oss-ptah")).toBe(true);
    expect(estimateCost("ollama/gemma:latest", 1_000_000, 1_000_000)).toBe(0);
  });
  test("lmstudio/llamacpp free", () => {
    expect(isFree("lmstudio/gemma")).toBe(true);
    expect(isFree("llamacpp-lan/gpt-oss")).toBe(true);
  });
  test("cloud models cost money", () => {
    expect(estimateCost("anthropic/claude-sonnet-4-5", 1_000_000, 0)).toBe(3);
    expect(estimateCost("anthropic/claude-sonnet-4-5", 0, 1_000_000)).toBe(15);
    expect(estimateCost("anthropic/claude-sonnet-4-5", 1_000_000, 1_000_000)).toBe(18);
  });
  test("unknown cloud model defaults to zero price (safe)", () => {
    expect(priceFor("someprovider/unknown")).toEqual({ in: 0, out: 0 });
    expect(estimateCost("someprovider/unknown", 1000, 1000)).toBe(0);
  });
});

describe("cost report", () => {
  test("buildReport aggregates", () => {
    const usage = {
      "ollama/gemma:latest": { model: "ollama/gemma:latest", inputTokens: 100, outputTokens: 50 },
      "anthropic/claude-sonnet-4-5": {
        model: "anthropic/claude-sonnet-4-5",
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
    };
    const reports = buildReport(usage);
    expect(reports).toHaveLength(2);
    const local = reports.find((r) => r.model === "ollama/gemma:latest")!;
    expect(local.cost).toBe(0);
    const cloud = reports.find((r) => r.model === "anthropic/claude-sonnet-4-5")!;
    expect(cloud.cost).toBe(3);
  });
  test("formatReport includes total", () => {
    const reports = buildReport({
      "anthropic/claude-sonnet-4-5": {
        model: "anthropic/claude-sonnet-4-5",
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
    });
    const text = formatReport(reports);
    expect(text).toContain("TOTAL");
    expect(text).toContain("$3");
  });
  test("formatReport empty", () => {
    expect(formatReport([])).toContain("No usage");
  });
});

describe("session usage", () => {
  test("sessionUsage flattens per-session data", () => {
    const data = {
      "/tmp/proj-a": {
        "ollama/gemma:latest": { model: "ollama/gemma:latest", inputTokens: 100, outputTokens: 50 },
      },
      "/tmp/proj-b": {
        "anthropic/claude-sonnet-4-5": { model: "anthropic/claude-sonnet-4-5", inputTokens: 1_000_000, outputTokens: 0 },
      },
    };
    const rows = sessionUsage(data);
    expect(rows.length).toBe(2);
    expect(rows.find((r) => r.session === "/tmp/proj-a")?.model).toBe("ollama/gemma:latest");
    expect(rows.find((r) => r.session === "/tmp/proj-b")?.cost).toBe(3);
  });

  test("formatSessionUsage includes session and total", () => {
    const rows = sessionUsage({
      "/tmp/proj-a": {
        "anthropic/claude-sonnet-4-5": { model: "anthropic/claude-sonnet-4-5", inputTokens: 1_000_000, outputTokens: 0 },
      },
    });
    const text = formatSessionUsage(rows);
    expect(text).toContain("/tmp/proj-a");
    expect(text).toContain("TOTAL");
  });

  test("formatSessionUsage empty", () => {
    expect(formatSessionUsage([])).toContain("No usage");
  });
});

describe("usage tagging", () => {
  test("tagModel prefixes bare ids", async () => {
    const { tagModel, isFree } = await import("../src/cost.ts");
    expect(tagModel("qwen3.8:latest", false)).toBe("ollama-lan/qwen3.8:latest");
    expect(tagModel("glm-5.2", true)).toBe("ollama-cloud/glm-5.2");
    expect(isFree(tagModel("qwen3.8:latest", false))).toBe(true);
    expect(isFree(tagModel("glm-5.2", true))).toBe(false);
  });
});

// ---- atomic + tolerant usage persistence (F6, Wave 3c) ----

describe("usage.json atomic write + tolerant read (F6)", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "ra-usage-f6-"));

  test("writeJsonAtomic replaces the file wholesale — no .tmp residue, valid JSON on disk", () => {
    const d = dir();
    try {
      const p = join(d, "usage.json");
      writeJsonAtomic(p, { "ollama-lan/tiny": { model: "ollama-lan/tiny", inputTokens: 10, outputTokens: 5 } });
      writeJsonAtomic(p, { "codder/opus": { model: "codder/opus", inputTokens: 1, outputTokens: 2 } });
      expect(existsSync(p)).toBe(true);
      expect(readdirSync(d).filter((f) => f.includes(".tmp"))).toEqual([]); // rename, never a leftover
      expect(JSON.parse(readFileSync(p, "utf-8"))).toEqual({ "codder/opus": { model: "codder/opus", inputTokens: 1, outputTokens: 2 } });
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("corrupt JSON is backed up and read as fresh — never crashes cost reporting", () => {
    const d = dir();
    try {
      const p = join(d, "usage.json");
      writeFileSync(p, '{ "codder/opus": { "inputTokens": 12,', "utf-8"); // torn write
      const usage = loadUsageJson(p);
      expect(usage).toEqual({}); // fresh start, no throw
      const backups = readdirSync(d).filter((f) => f.startsWith("usage.json.corrupt-"));
      expect(backups.length).toBe(1); // the corrupt copy was preserved
      expect(readFileSync(join(d, backups[0]!), "utf-8")).toContain("inputTokens");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("non-object JSON (array/scalar) also resets instead of poisoning the map", () => {
    const d = dir();
    try {
      const p = join(d, "usage.json");
      for (const bad of ['["row"]', "42", '"str"', "null"]) {
        writeFileSync(p, bad, "utf-8");
        expect(loadUsageJson(p)).toEqual({});
      }
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("missing file reads as empty", () => {
    const d = dir();
    try {
      expect(loadUsageJson(join(d, "nope.json"))).toEqual({});
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("concurrent writers never leave a torn file for readers (interleaved atomic writes)", async () => {
    const d = dir();
    try {
      const p = join(d, "usage.json");
      // Interleave: every writer builds on what it read, then atomically swaps.
      // A reader between any two steps always sees complete JSON.
      const writers = Array.from({ length: 4 }, (_, w) =>
        Array.from({ length: 10 }, (_, i) => {
          const cur = loadUsageJson(p);
          cur[`m${w}-${i}`] = { model: `m${w}-${i}`, inputTokens: 1, outputTokens: 1 };
          writeJsonAtomic(p, cur);
          // reader invariant: file parses at every observation point
          expect(loadUsageJson(p)).toBeTruthy();
        }));
      for (const seq of writers) seq.forEach((step) => void step);
      // Final state: valid JSON (last writer wins wholesale — no merge, see ceiling note)
      const final = JSON.parse(readFileSync(p, "utf-8"));
      expect(typeof final).toBe("object");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("per-provider price overrides (D2)", () => {
  afterEach(() => clearPriceOverrides());

  test("provider models.cost block (opencode schema) yields non-zero cost from a usage row", () => {
    const overrides = priceOverridesFromConfig({
      provider: {
        "gto-code": {
          options: { baseURL: "http://host/v1" },
          models: {
            "bonsai-code-27b": { cost: { input: 0.6, output: 2.2 } },
          },
        },
      },
    });
    setPriceOverrides(overrides);
    // usage rows are tagged by recordChatUsage; provider-prefixed id must price
    const reports = buildReport({
      "gto-code/bonsai-code-27b": { model: "gto-code/bonsai-code-27b", inputTokens: 1_000_000, outputTokens: 1_000_000 },
    });
    expect(reports[0]!.cost).toBe(0.6 + 2.2);
    expect(estimateCost("gto-code/bonsai-code-27b", 1e6, 0)).toBe(0.6);
  });

  test("bare server-reported id still finds its provider override", () => {
    setPriceOverrides(priceOverridesFromConfig({
      provider: { "my-gateway": { options: { baseURL: "http://h/v1" }, models: { "glm-4.6": { cost: { input: 0.6, output: 2.2 } } } } },
    }));
    // recordChatUsage tags a bare cloud-reported id as ollama-cloud/<id>
    expect(priceFor("ollama-cloud/glm-4.6").in).toBe(0.6);
  });

  test("options.pricing applies per-provider; top-level pricing map wins overall", () => {
    setPriceOverrides(priceOverridesFromConfig({
      provider: {
        acme: {
          options: { pricing: { input_per_m: 1, output_per_m: 5 } },
          models: { "m1": {}, "m2": { cost: { input: 9, output: 9 } } },
        },
      },
      pricing: { "acme/m2": { input_per_m: 0.5, output_per_m: 0.25 } },
    }));
    expect(priceFor("acme/m1")).toEqual({ in: 1, out: 5 });
    expect(priceFor("acme/m2")).toEqual({ in: 0.5, out: 0.25 });
  });

  test("unknown custom providers still fall back to $0 (no throw)", () => {
    setPriceOverrides(priceOverridesFromConfig({ provider: { x: { models: { y: { cost: { input: "bad", output: -1 } } } } } }));
    expect(priceFor("x/y")).toEqual({ in: 0, out: 0 });
    expect(priceFor("other/unknown")).toEqual({ in: 0, out: 0 });
  });
});
