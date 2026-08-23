import { describe, expect, test } from "bun:test";
import {
  estimateCost,
  isFree,
  priceFor,
  buildReport,
  formatReport,
  sessionUsage,
  formatSessionUsage,
} from "../src/cost.ts";

describe("cost estimation", () => {
  test("local ollama is free", () => {
    expect(isFree("ollama/gemma:latest")).toBe(true);
    expect(isFree("ollama-lan/qwen3-ptah")).toBe(true);
    expect(estimateCost("ollama/gemma:latest", 1_000_000, 1_000_000)).toBe(0);
  });
  test("lmstudio/llamacpp free", () => {
    expect(isFree("lmstudio/gemma")).toBe(true);
    expect(isFree("llamacpp-lan/qwen")).toBe(true);
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
