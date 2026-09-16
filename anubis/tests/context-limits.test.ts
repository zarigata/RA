// tests/context-limits.test.ts — context-window registry (ra.78): resolution
// precedence (config > probe > table > default), the num_ctx server cap, the
// per-run ledger, and the plumbing that reaches native Ollama.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  CONTEXT_TABLE,
  tableContext,
  contextPolicy,
  modelKind,
  modelMaxContext,
  modelMaxContextLive,
  usableContext,
  serverCapFor,
  numCtxFor,
  outputReserve,
  minContextForJob,
  formatContext,
  ContextLedger,
  DEFAULT_LOCAL_CONTEXT,
  DEFAULT_CLOUD_CONTEXT,
  DEFAULT_LOCAL_CAP,
  resetContextProbeCache,
} from "../src/context-limits.ts";
import { OllamaClient, nativeOptions, isContextOverflowError } from "../src/ollama.ts";
import { estimateTokensFromChars } from "../src/cost.ts";
import type { RaConfig } from "../src/config.ts";

const config: RaConfig = {
  model: "ollama-cloud/glm-5.2",
  small_model: "ollama-lan/gpt-oss:20b",
  agent: {},
  provider: {
    "ollama-cloud": { options: { baseURL: "https://ollama.com/v1" }, models: { "glm-5.2": {} } },
    "ollama-lan": { options: { baseURL: "http://192.168.1.251:11434/v1" }, models: { "gpt-oss:20b": { context: 65536 } } },
    google: { options: { baseURL: "https://generativelanguage.googleapis.com/v1beta" }, models: { "gemini-3-pro": {} } },
  },
};

describe("static context table", () => {
  test("qwen3.8's nominal 262k is in the table — and flagged for clamping", () => {
    expect(tableContext("qwen3.8-max")).toBe(256 * 1024);
    const entry = CONTEXT_TABLE.find((e) => e.match.includes("qwen3.8"))!;
    expect(entry.note).toContain("clamp");
  });

  test("specific entries precede families", () => {
    expect(tableContext("gemma2:2b")).toBe(8 * 1024); // gemma2 is 8k
    expect(tableContext("gemma3:4b")).toBe(128 * 1024); // gemma3+ is 128k
    expect(tableContext("llama3.1:8b")).toBe(128 * 1024);
    expect(tableContext("llama3:8b")).toBe(8 * 1024); // generic llama conservative
    expect(tableContext("totally-unknown")).toBeNull();
  });
});

describe("modelMaxContext resolution order", () => {
  test("config override (provider model entry) beats the table", () => {
    const info = modelMaxContext("ollama-lan/gpt-oss:20b", config);
    expect(info).toEqual({ windowTokens: 65536, source: "config" }); // not the 128k table value
  });

  test("model_overrides win for bare and prefixed ids", () => {
    const cfg: RaConfig = { ...config, context: { model_overrides: { "gpt-oss:20b": 4096 } } };
    expect(modelMaxContext("ollama-lan/gpt-oss:20b", cfg).windowTokens).toBe(4096);
    expect(modelMaxContext("gpt-oss:20b", cfg).source).toBe("config");
  });

  test("table entries apply without config; unknowns default conservatively by kind", () => {
    expect(modelMaxContext("ollama-lan/qwen3.8", config)).toEqual({ windowTokens: 256 * 1024, source: "table" });
    expect(modelMaxContext("ollama-lan/mystery-model", config).windowTokens).toBe(DEFAULT_LOCAL_CONTEXT);
    expect(modelMaxContext("ollama-cloud/mystery-model", config).windowTokens).toBe(DEFAULT_CLOUD_CONTEXT);
    expect(modelKind("ollama-cloud/x")).toBe("cloud");
    expect(modelKind("ollama-lan/x")).toBe("local");
    expect(modelKind("google/gemini-3-pro", config)).toBe("cloud");
  });
});

describe("usable window: the num_ctx cap", () => {
  test("a 262k model on a capped LAN host is a 32k model, full stop", () => {
    const policy = contextPolicy({ context: { server_cap: { "ollama-lan": 32768 } } });
    const max = modelMaxContext("ollama-lan/qwen3.8", config);
    const usable = usableContext(max, "ollama-lan/qwen3.8", "local", policy);
    expect(usable.windowTokens).toBe(32768);
    expect(usable.cap).toBe(32768);
    expect(formatContext(usable, max)).toContain("capped");
  });

  test("local default cap applies without explicit server_cap; cloud is never capped", () => {
    const policy = contextPolicy();
    expect(serverCapFor("ollama-lan/x", "local", policy)).toBe(DEFAULT_LOCAL_CAP);
    expect(serverCapFor("anything", "cloud", policy)).toBeNull();
    expect(usableContext({ windowTokens: 1_000_000, source: "table" }, "ollama-cloud/x", "cloud", policy).windowTokens).toBe(1_000_000);
  });

  test("explicit cap below the window leaves small windows untouched", () => {
    const policy = contextPolicy({ context: { server_cap: { lmstudio: 8192 } } });
    const usable = usableContext({ windowTokens: 4096, source: "config" }, "lmstudio/tiny", "local", policy);
    expect(usable.windowTokens).toBe(4096);
    expect(usable.cap).toBeUndefined();
  });
});

describe("context policy defaults", () => {
  test("watermarks, resume limit, adaptive default", () => {
    const p = contextPolicy();
    expect(p.adaptive).toBe(true);
    expect(p.resumeLimit).toBe(3);
    expect(p.lowWatermark).toBe(0.7);
    expect(p.criticalWatermark).toBe(0.9);
    expect(p.minContextTokens).toBe(8192);
  });

  test("critical stays above low even with odd inputs", () => {
    const p = contextPolicy({ context: { low_watermark: 0.95, critical_watermark: 0.9 } });
    expect(p.criticalWatermark).toBeGreaterThan(p.lowWatermark);
    expect(contextPolicy({ context: { adaptive: false } }).adaptive).toBe(false);
  });

  test("job floors: code/reasoning need more window than chat", () => {
    const p = contextPolicy();
    expect(minContextForJob("code", p)).toBe(16384);
    expect(minContextForJob("chat", p)).toBe(8192);
    expect(minContextForJob("chat", contextPolicy({ context: { min_context_tokens: 32768 } }))).toBe(32768);
  });
});

describe("token ledger", () => {
  const policy = contextPolicy({ context: { low_watermark: 0.5, critical_watermark: 0.8 } });

  test("estimate-based pressure transitions", () => {
    const ledger = new ContextLedger("m", 4096, policy);
    expect(ledger.budgetTokens).toBe(4096 - outputReserve(4096));
    const small = [{ content: "x".repeat(400) }]; // ~100 tokens
    expect(ledger.pressure(small)).toBe("ok");
    const low = [{ content: "x".repeat((ledger.budgetTokens * 0.5 * 4) + 40) }];
    expect(ledger.pressure(low)).toBe("low");
    const critical = [{ content: "x".repeat((ledger.budgetTokens * 0.8 * 4) + 40) }];
    expect(ledger.pressure(critical)).toBe("critical");
    expect(ledger.remaining(critical)).toBeLessThan(700);
  });

  test("real usage calibrates and wins when larger than the estimate", () => {
    const ledger = new ContextLedger("m", 8192, policy);
    const msgs = [{ content: "a".repeat(4000) }, { content: "b".repeat(4000) }]; // ~2000 est
    ledger.noteUsage({ prompt_tokens: 6000, completion_tokens: 500 }, msgs.length);
    const grown = [...msgs, { content: "c".repeat(2000) }]; // +500 estimated
    // real-based: 6000 + 500 + 500 = 7000 > estimate 2500
    expect(ledger.usedTokens(grown)).toBeGreaterThanOrEqual(7000);
    expect(ledger.pressure(grown)).toBe("critical");
  });

  test("estimateTokensFromChars is the ~4 chars/token heuristic", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(400)).toBe(100);
  });
});

describe("num_ctx plumbing", () => {
  test("nativeOptions carries temperature, num_ctx and num_predict", () => {
    expect(nativeOptions({ temperature: 0.2, contextTokens: 4096, maxTokens: 512 })).toEqual({
      options: { temperature: 0.2, num_ctx: 4096, num_predict: 512 },
    });
    expect(nativeOptions({})).toEqual({});
    expect(nativeOptions({ contextTokens: 100 })).toEqual({ options: { num_ctx: 2048 } }); // floor
    expect(numCtxFor(999)).toBe(2048);
  });

  test("isContextOverflowError matches provider refusal shapes", () => {
    expect(isContextOverflowError(new Error("input length exceeds context length"))).toBe(true);
    expect(isContextOverflowError(new Error("prompt too long: 9000 tokens > 8192 maximum"))).toBe(true);
    expect(isContextOverflowError(new Error("Requested tokens exceed the context window"))).toBe(true);
    expect(isContextOverflowError(new Error("429 Too Many Requests"))).toBe(false);
    expect(isContextOverflowError(new Error("401 unauthorized"))).toBe(false);
    expect(isContextOverflowError(new Error("econnreset"))).toBe(false);
  });
});

// ---- live probe + request-body assertions against a fake Ollama ----

let server: ReturnType<typeof Bun.serve>;
let serverURL = "";
const chatBodies: Array<Record<string, unknown>> = [];

beforeAll(() => {
  resetContextProbeCache();
  chatBodies.length = 0;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/tags") {
        return Response.json({ models: [{ name: "fake-model" }] });
      }
      if (url.pathname === "/api/show") {
        const body = (await req.json()) as { model?: string };
        if (body.model === "fake-model") {
          return Response.json({ model_info: { "llama.context_length": 16384, "llama.embedding_length": 4096 } });
        }
        return new Response("not found", { status: 404 });
      }
      if (url.pathname === "/api/chat") {
        const body = (await req.json()) as Record<string, unknown>;
        chatBodies.push(body);
        return new Response(
          JSON.stringify({ message: { content: "hi" }, done: true, model: "fake-model", prompt_eval_count: 10, eval_count: 2 }) + "\n",
          { headers: { "Content-Type": "application/x-ndjson" } },
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  serverURL = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  resetContextProbeCache();
});

describe("live probe + streaming request body", () => {
  test("showContext reads *.context_length from /api/show", async () => {
    const client = OllamaClient.fromLocal(serverURL);
    expect(await client.showContext("fake-model")).toBe(16384);
    expect(await client.showContext("missing-model")).toBeNull();
  });

  test("modelMaxContextLive folds the probe in; config still wins", async () => {
    const client = OllamaClient.fromLocal(serverURL);
    // no table entry for fake-model, no config → probe result
    const probed = await modelMaxContextLive(client, "fake-model", config);
    expect(probed).toEqual({ windowTokens: 16384, source: "probe" });
    // config override wins over the probe
    const cfg: RaConfig = {
      provider: { fakelan: { options: { baseURL: serverURL }, models: { "fake-model": { context: 4096 } } } },
    };
    const pinned = await modelMaxContextLive(client, "fakelan/fake-model", cfg);
    expect(pinned).toEqual({ windowTokens: 4096, source: "config" });
  });

  test("nativeChatStream sends options.num_ctx from contextTokens", async () => {
    const client = OllamaClient.fromLocal(serverURL);
    const res = await client.nativeChatStream("fake-model", [{ role: "user", content: "hello" }], { contextTokens: 8192, maxTokens: 64 });
    expect(res.content).toBe("hi");
    expect(res.usage?.prompt_tokens).toBe(10);
    const body = chatBodies.at(-1)!;
    expect(body.options).toEqual({ num_ctx: 8192, num_predict: 64 });
  });

  test("OpenAI-compat showContext reads /v1/models annotations", async () => {
    const s2 = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "m1", max_context_length: 32768 }, { id: "m2" }] });
        }
        return new Response("nope", { status: 404 });
      },
    });
    try {
      const client = OllamaClient.fromOpenAI(`http://localhost:${s2.port}`);
      expect(await client.showContext("m1")).toBe(32768);
      expect(await client.showContext("m2")).toBeNull();
    } finally {
      s2.stop(true);
    }
  });
});
