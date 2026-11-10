// tests/routing.test.ts — hybrid local↔cloud routing (ra.76).
// Pins: the four modes, tier interaction, budget downshift, cross-kind
// escalation, RA_ROUTING override, and the latency cache.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  resolveRoutingMode,
  applyRoutingMode,
  isCloudModelId,
  isOverBudget,
  downshiftForBudget,
  escalationChain,
} from "../src/routing.ts";
import { recordLatency, latencyFor, isLocalDegraded, formatLatency } from "../src/latency.ts";
import type { RaConfig } from "../../anubis/src/config.ts";
import { rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const base: Pick<RaConfig, "model" | "small_model" | "routing" | "budget"> = {
  model: "ollama-cloud/glm-5.2",
  small_model: "ollama-lan/qwen3.8:latest",
};

describe("routing modes", () => {
  test("defaults to local-first; RA_ROUTING env wins over config", () => {
    expect(resolveRoutingMode(base)).toBe("local-first");
    expect(resolveRoutingMode({ ...base, routing: { mode: "balanced" } }, { RA_ROUTING: "economy" })).toBe("economy");
    expect(resolveRoutingMode(base, { RA_ROUTING: "nonsense" })).toBe("local-first");
  });

  test("local-first and balanced trust the tier decision", () => {
    for (const mode of ["local-first", "balanced"] as const) {
      expect(applyRoutingMode("ollama-lan/qwen3.8:latest", "code", { ...base, routing: { mode } })).toBe("ollama-lan/qwen3.8:latest");
      expect(applyRoutingMode("ollama-cloud/glm-5.2", "meta", { ...base, routing: { mode } })).toBe("ollama-cloud/glm-5.2");
    }
  });

  test("quality-first sends everything but meta to the cloud lane", () => {
    const cfg = { ...base, routing: { mode: "quality-first" as const } };
    expect(applyRoutingMode("ollama-lan/qwen3.8:latest", "code", cfg)).toBe("ollama-cloud/glm-5.2");
    expect(applyRoutingMode("ollama-lan/qwen3.8:latest", "heavy", cfg)).toBe("ollama-cloud/glm-5.2");
    expect(applyRoutingMode("ollama-cloud/glm-5.2", "meta", cfg)).toBe("ollama-lan/qwen3.8:latest");
  });

  test("economy pins every tier to the local lane", () => {
    const cfg = { ...base, routing: { mode: "economy" as const } };
    expect(applyRoutingMode("ollama-cloud/glm-5.2", "code", cfg)).toBe("ollama-lan/qwen3.8:latest");
    expect(applyRoutingMode("ollama-cloud/glm-5.2", "heavy", cfg)).toBe("ollama-lan/qwen3.8:latest");
  });

  test("cloud model detection", () => {
    expect(isCloudModelId("ollama-cloud/glm-5.2")).toBe(true);
    expect(isCloudModelId("cloud/x")).toBe(true);
    expect(isCloudModelId("ollama-lan/qwen3.8:latest")).toBe(false);
    expect(isCloudModelId("zai/glm-4.6")).toBe(false);
  });

  test("cloud model detection honors provider-block baseURLs (custom gateways)", () => {
    // Wave 2: codder/* on a remote baseURL is cloud for escalation/budget;
    // a localhost provider block (LAN shim, LM Studio) stays local.
    const providers = {
      codder: { options: { baseURL: "https://cloud-gw.example.test/v1" } },
      test: { options: { baseURL: "http://localhost:20123/v1" } },
    };
    expect(isCloudModelId("codder/claude-opus-5-5", providers)).toBe(true);
    expect(isCloudModelId("test/qwen3.8", providers)).toBe(false);
    expect(isCloudModelId("codder/x", undefined)).toBe(false); // no dict → legacy prefix-only
  });
});

describe("budget guard", () => {
  test("isOverBudget: no cap configured → never over", () => {
    expect(isOverBudget(999, base)).toBe(false);
  });

  test("downshift replaces cloud with the local lane past the cap", () => {
    const cfg = { ...base, budget: { session_usd: 1 } };
    expect(downshiftForBudget("ollama-cloud/glm-5.2", cfg, 0.5)).toBeNull();
    expect(downshiftForBudget("ollama-cloud/glm-5.2", cfg, 1.2)).toBe("ollama-lan/qwen3.8:latest");
    expect(downshiftForBudget("ollama-lan/qwen3.8:latest", cfg, 5)).toBeNull(); // local never downshifts
  });
});

describe("cross-kind escalation", () => {
  test("balanced mode appends cloud to a local primary", () => {
    const chain = escalationChain("ollama-lan/qwen3.8:latest", { ...base, routing: { mode: "balanced" } }, 0);
    expect(chain).toEqual(["ollama-cloud/glm-5.2"]);
  });

  test("local-first keeps the strict same-kind contract", () => {
    expect(escalationChain("ollama-lan/qwen3.8:latest", base, 0)).toEqual([]);
    expect(escalationChain("ollama-cloud/glm-5.2", base, 0)).toEqual([]);
  });

  test("budget breach appends local to a cloud primary in any mode", () => {
    const chain = escalationChain("ollama-cloud/glm-5.2", { ...base, budget: { session_usd: 0.5 } }, 2);
    expect(chain).toEqual(["ollama-lan/qwen3.8:latest"]);
  });

  test("balanced mode escalates local → a custom cloud-gateway BIG (codder/*)", () => {
    // Wave 2 dual-lane: the escalation path small@201 → BIG@codder.
    const providers = { codder: { options: { baseURL: "https://cloud-gw.example.test/v1" } } };
    const chain = escalationChain("test/qwen3.8", { ...base, routing: { mode: "balanced" }, model: "codder/claude-opus-5-5", provider: providers }, 0);
    expect(chain).toEqual(["codder/claude-opus-5-5"]);
    // budget breach on the cloud lane downshifts to the local lane
    const down = downshiftForBudget("codder/claude-opus-5-5", { ...base, small_model: "test/qwen3.8", budget: { session_usd: 0.5 }, provider: providers }, 2);
    expect(down).toBe("test/qwen3.8");
  });
});

describe("latency cache", () => {
  const storePath = join(tmpdir(), "ra-routing-test", "latency.json");
  beforeAll(() => {
    mkdirSync(dirname(storePath), { recursive: true });
    rmSync(storePath, { force: true });
    process.env.RA_LATENCY_PATH = storePath;
  });
  afterAll(() => { delete process.env.RA_LATENCY_PATH; rmSync(dirname(storePath), { recursive: true, force: true }); });

  test("records samples and reports the median", () => {
    recordLatency("251", 100);
    recordLatency("251", 300);
    recordLatency("251", 200);
    expect(latencyFor("251")).toBe(200);
    expect(formatLatency()).toContain("251");
  });

  test("degraded detection uses the best local host", () => {
    recordLatency("local", 25_000);
    // .251 is fast (200ms median so far) → lane is not degraded
    expect(isLocalDegraded(20_000)).toBe(false);
    // push the .251 window fully into slow samples
    for (const ms of [26_000, 27_000, 28_000, 29_000, 30_000]) recordLatency("251", ms);
    // now every local host is slow → degraded
    expect(isLocalDegraded(20_000)).toBe(true);
    expect(isLocalDegraded(40_000)).toBe(false);
  });
});
