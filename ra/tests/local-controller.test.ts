import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRoutingMode, isCloudModelId, downshiftForBudget } from "../../anubis/src/routing.ts";
import { localModelPreset } from "../src/local-models.ts";
import { memoryPacket } from "../src/memory-cards.ts";
test("custom cloud providers obey budget guard", () => {
  for (const id of ["anthropic/claude", "openrouter/a/b", "zai/glm", "ollama-cloud/model"]) {
    expect(isCloudModelId(id)).toBe(true);
    expect(downshiftForBudget(id, { small_model: "ollama/qwen3:4b", budget: { session_usd: 1 } }, 2)).toBe("ollama/qwen3:4b");
  }
  expect(isCloudModelId("ollama/qwen3:4b")).toBe(false);
});
test("local-controller sends only coding tiers to configured coder", () => {
  const c = { model: "openrouter/coder", small_model: "ollama/qwen3:4b", routing: { mode: "local-controller" as const } };
  expect(applyRoutingMode(c.model, "meta", c)).toBe(c.small_model);
  expect(applyRoutingMode(c.small_model, "code", c)).toBe(c.model);
  expect(() => applyRoutingMode(c.model, "meta", { ...c, small_model: c.model })).toThrow();
});
test("VRAM presets reserve headroom and reject invalid detection", () => {
  expect([4, 8, 12].map(v => localModelPreset(v).model)).toEqual(["ollama/qwen3:4b", "ollama/qwen3:8b", "ollama/qwen3:14b"]);
  expect(() => localModelPreset(NaN)).toThrow();
});
test("memory selects relevant cards, preserves required cards, refuses silent required loss", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ra-memory-"));
  try {
    mkdirSync(join(cwd, ".ra"));
    writeFileSync(join(cwd, ".ra/memory-cards.json"), JSON.stringify([
      { id: "contract", summary: "Always validate tests", required: true },
      { id: "connector", summary: "API uses a request envelope", tags: ["api"] },
      { id: "unrelated", summary: "Other project", tags: ["other"] },
    ]));
    const p = memoryPacket(cwd, "fix api");
    expect(p).toContain("contract"); expect(p).toContain("connector"); expect(p).not.toContain("unrelated");
    expect(() => memoryPacket(cwd, "api", 1)).toThrow();
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
