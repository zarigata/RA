// context-watermark.test.ts — Wave 3a boundary sweep: context-policy
// arithmetic at the watermark boundaries (0/69/70/71/89/90/91/100% of the
// budget), resume_limit decay (resumeStepBudget), usableContext clamping,
// outputReserve, and escalation eligibility (pickContextEscalation's pure
// prerequisites: window comparison via escalation candidates).

import { describe, expect, test } from "bun:test";
import {
  contextPolicy, modelMaxContext, usableContext, serverCapFor, outputReserve,
  numCtxFor, tableContext, minContextForJob, ContextLedger, DEFAULT_LOCAL_CONTEXT,
  DEFAULT_CLOUD_CONTEXT, DEFAULT_LOCAL_CAP, formatContext,
} from "../../anubis/src/context-limits.ts";
import { resumeStepBudget } from "../src/resume.ts";

const K = 1024;

describe("contextPolicy — watermark defaults + clamping", () => {
  test("defaults: adaptive on, 3 resumes, 0.7/0.9 watermarks, 8192 floor", () => {
    const p = contextPolicy();
    expect(p.adaptive).toBe(true);
    expect(p.resumeLimit).toBe(3);
    expect(p.lowWatermark).toBe(0.7);
    expect(p.criticalWatermark).toBe(0.9);
    expect(p.minContextTokens).toBe(8192);
  });

  test("custom watermarks apply; critical always > low (forced apart when crossed)", () => {
    expect(contextPolicy({ context: { low_watermark: 0.5, critical_watermark: 0.8 } }).lowWatermark).toBe(0.5);
    expect(contextPolicy({ context: { low_watermark: 0.5, critical_watermark: 0.8 } }).criticalWatermark).toBe(0.8);
    // crossed config: critical is nudged above low
    const crossed = contextPolicy({ context: { low_watermark: 0.9, critical_watermark: 0.5 } });
    expect(crossed.criticalWatermark).toBeGreaterThan(crossed.lowWatermark);
    expect(crossed.criticalWatermark).toBeCloseTo(0.91, 2);
  });

  test("watermarks clamp into (0.05..1]; resume_limit floors at 0", () => {
    const p = contextPolicy({ context: { low_watermark: 0, critical_watermark: 2, resume_limit: -3, min_context_tokens: -5 } });
    expect(p.lowWatermark).toBeCloseTo(0.05, 5);
    expect(p.criticalWatermark).toBe(1);
    expect(p.resumeLimit).toBe(0);
    expect(p.minContextTokens).toBe(0);
  });

  test("adaptive:false survives; server_cap + model_overrides pass through", () => {
    const p = contextPolicy({ context: { adaptive: false, server_cap: { "ollama-lan": 16384 }, model_overrides: { m: 999 } } });
    expect(p.adaptive).toBe(false);
    expect(p.serverCap["ollama-lan"]).toBe(16384);
    expect(p.modelOverrides["m"]).toBe(999);
  });
});

describe("ContextLedger — the 0/69/70/71/89/90/91/100% boundary table", () => {
  // window 100000, reserve = clamp(100000/8) = 8192 → budget 91808.
  // low at 0.7 → 64265.6; critical at 0.9 → 82627.2.
  const ledger = new ContextLedger("m", 100_000, contextPolicy());
  const budget = ledger.budgetTokens;
  const msgs = (frac: number) => [{ content: "x".repeat(Math.floor(budget * frac * 4)) }];
  // est = ceil(chars/4) ≈ budget*frac — stay strictly on each side of the edges.

  const table: Array<[number, "ok" | "low" | "critical", string]> = [
    [0.0, "ok", "empty transcript"],
    [0.5, "ok", "half window"],
    [0.69, "ok", "just below low watermark"],
    [0.70, "low", "at low watermark (ceil(budget*0.7) tokens ≥ edge)"],
    [0.71, "low", "just above low"],
    [0.89, "low", "just below critical"],
    [0.905, "critical", "at critical (ceil tokens ≥ the 82627.2 edge)"],
    [0.91, "critical", "just above critical"],
    [1.0, "critical", "full budget"],
    [2.0, "critical", "over budget"],
  ];

  for (const [frac, want, label] of table) {
    test(`${label} (${Math.round(frac * 100)}%) → ${want}`, () => {
      expect(ledger.pressure(msgs(frac))).toBe(want); // frac=${frac}
    });
  }

  test("boundary inclusion is >= for both watermarks (ceil-token edges)", () => {
    // usedTokens = ceil(chars/4); the comparison is used >= budget*wm with the
    // exact float edge — pin the first integer token count that trips each.
    const exact = (tokens: number) => [{ content: "a".repeat(tokens * 4 - 1) }]; // ceil = tokens
    const l = new ContextLedger("m", 100_000, contextPolicy());
    const lowEdge = Math.ceil(l.budgetTokens * 0.7);
    expect(l.pressure(exact(lowEdge - 1))).toBe("ok");
    expect(l.pressure(exact(lowEdge))).toBe("low");
    const critEdge = Math.ceil(l.budgetTokens * 0.9);
    expect(l.pressure(exact(critEdge - 1))).toBe("low");
    expect(l.pressure(exact(critEdge))).toBe("critical");
  });

  test("remaining never goes negative; counts down linearly", () => {
    expect(ledger.remaining([])).toBe(budget);
    expect(ledger.remaining(msgs(0.5))).toBeLessThanOrEqual(Math.ceil(budget * 0.5));
    expect(ledger.remaining(msgs(5))).toBe(0);
  });

  test("real usage numbers beat the chars estimate (max, not replace)", () => {
    const l = new ContextLedger("m", 100_000, contextPolicy());
    l.noteUsage({ prompt_tokens: 70_000, completion_tokens: 10_000 }, 1); // 80k > 0.7*91808
    // tiny visible history but big real usage → real wins → low
    expect(l.pressure([{ content: "hi" }])).toBe("low");
    // new messages add on top of the calibrated count
    expect(l.usedTokens([{ content: "hi" }, { content: "y".repeat(4_000) }])).toBeGreaterThanOrEqual(80_000 + 1_000 - 1);
  });

  test("budgetTokens = window - outputReserve; reserve clamps to [1024, 8192]", () => {
    expect(outputReserve(100_000)).toBe(8192);
    expect(outputReserve(65_536)).toBe(8192); // 65536/8 = 8192 exactly
    expect(outputReserve(16_384)).toBe(2048);
    expect(outputReserve(4_096)).toBe(1024); // floor
    expect(new ContextLedger("m", 4_096, contextPolicy()).budgetTokens).toBe(3_072);
    expect(new ContextLedger("m", 100, contextPolicy()).budgetTokens).toBe(1); // degenerate window ≥1
  });
});

describe("resumeStepBudget — continuation decay ladder", () => {
  test("base → 75% → 50% → 50% → 50%…, never below 2", () => {
    expect(resumeStepBudget(10, 0)).toBe(10);
    expect(resumeStepBudget(10, 1)).toBe(7); // floor(10*0.75) = 7.5 → 7
    expect(resumeStepBudget(10, 2)).toBe(5);
    expect(resumeStepBudget(10, 3)).toBe(5);
    expect(resumeStepBudget(10, 4)).toBe(5);
    expect(resumeStepBudget(10, 99)).toBe(5);
  });

  test("the exact 0.75 arithmetic on even bases", () => {
    expect(resumeStepBudget(8, 1)).toBe(6); // 8*.75 = 6 exact
    expect(resumeStepBudget(4, 1)).toBe(3);
  });

  test("small bases clamp at the floor of 2", () => {
    for (const base of [1, 2, 3]) {
      for (const r of [0, 1, 2, 3, 10]) {
        expect(resumeStepBudget(base, r)).toBeGreaterThanOrEqual(2); // base=${base} r=${r}
      }
    }
    expect(resumeStepBudget(1, 5)).toBe(2);
    expect(resumeStepBudget(2, 5)).toBe(2);
  });
});

describe("modelMaxContext — resolution precedence + table matches", () => {
  test("override keys: full id wins, bare id second, table after, default last", () => {
    expect(modelMaxContext("prov/qwen3.8", { context: { model_overrides: { "prov/qwen3.8": 111 }, "qwen3.8": 222 } } as never).windowTokens).toBe(111);
    expect(modelMaxContext("prov/qwen3.8", { context: { model_overrides: { "qwen3.8": 222 } } } as never).windowTokens).toBe(222);
    expect(modelMaxContext("prov/qwen3.8").windowTokens).toBe(256 * K); // table: qwen3.8
    expect(modelMaxContext("prov/unknown-model").windowTokens).toBe(DEFAULT_LOCAL_CONTEXT); // default (local kind)
  });

  test("table matches on the BARE id (substring); provider prefix never consulted", () => {
    expect(tableContext("ollama/qwen3.8")).toBe(256 * K); // bare contains qwen3.8
    expect(tableContext("my-qwen3.8-tuned")).toBe(256 * K); // substring match
    expect(tableContext("llama3.1")).toBe(128 * K);
    expect(tableContext("gemma2:2b")).toBe(8 * K);
    expect(tableContext("gemma3")).toBe(128 * K);
    expect(tableContext("")).toBeNull();
    // NOTE: "llamacpp" the bare model id WOULD hit the llama entry (substring
    // semantics) — that's why modelMaxContext strips the provider prefix first;
    // the provider prefix "llamacpp/..." itself is never table-matched.
    expect(tableContext("llamacpp")).toBe(8 * K); // documented substring quirk
    expect(modelMaxContext("llamacpp/some-model").windowTokens).toBe(DEFAULT_LOCAL_CONTEXT); // prefix stripped → no match → default
  });

  test("kind split: cloud defaults 32k, local defaults 8k", () => {
    expect(modelMaxContext("ollama-cloud/mystery").windowTokens).toBe(DEFAULT_CLOUD_CONTEXT);
    expect(modelMaxContext("ollama-lan/mystery").windowTokens).toBe(DEFAULT_LOCAL_CONTEXT);
    expect(modelMaxContext("mystery").windowTokens).toBe(DEFAULT_LOCAL_CONTEXT);
  });

  test("provider-block baseURL decides cloud vs local for the default (Wave 2)", () => {
    const cfg = { provider: { codder: { options: { baseURL: "https://cloud-gw.example.test/v1" } } } } as never;
    expect(modelMaxContext("codder/mystery", cfg).windowTokens).toBe(DEFAULT_CLOUD_CONTEXT);
    const local = { provider: { shim: { options: { baseURL: "http://localhost:1234/v1" } } } } as never;
    expect(modelMaxContext("shim/mystery", local).windowTokens).toBe(DEFAULT_LOCAL_CONTEXT);
  });
});

describe("usableContext — server_cap clamping (local only)", () => {
  const policy = contextPolicy({ context: { server_cap: { "ollama-lan": 16 * K } } });

  test("local model clamped by explicit server_cap; cap recorded", () => {
    const max = { windowTokens: 256 * K, source: "table" as const };
    const u = usableContext(max, "ollama-lan/qwen3.8", "local", policy);
    expect(u.windowTokens).toBe(16 * K);
    expect(u.cap).toBe(16 * K);
    expect(u.source).toBe("table");
  });

  test("cap never RAISES a smaller window", () => {
    const max = { windowTokens: 8 * K, source: "table" as const };
    expect(usableContext(max, "ollama-lan/gemma2", "local", policy).windowTokens).toBe(8 * K);
  });

  test("cloud models are never capped (null cap)", () => {
    const max = { windowTokens: 200 * K, source: "table" as const };
    const u = usableContext(max, "ollama-cloud/claude", "cloud", policy);
    expect(u.windowTokens).toBe(200 * K);
    expect(u.cap).toBeUndefined();
    expect(serverCapFor("any/x", "cloud", policy)).toBeNull();
  });

  test("local default cap 32768 when no explicit entry", () => {
    const max = { windowTokens: 256 * K, source: "table" as const };
    expect(usableContext(max, "ollama/whatever", "local", policy).windowTokens).toBe(DEFAULT_LOCAL_CAP);
  });

  test("numCtxFor floors at 2048 for the native Ollama reservation", () => {
    expect(numCtxFor(16 * K)).toBe(16 * K);
    expect(numCtxFor(100)).toBe(2048);
    expect(numCtxFor(2048)).toBe(2048);
  });
});

describe("escalation eligibility prerequisites (window arithmetic)", () => {
  test("minContextForJob: code/reasoning jobs need 16k, others the policy floor", () => {
    const p = contextPolicy();
    expect(minContextForJob("code", p)).toBe(16384);
    expect(minContextForJob("reasoning", p)).toBe(16384);
    expect(minContextForJob("chat", p)).toBe(8192);
    expect(minContextForJob("meta", p)).toBe(8192);
    // a raised floor propagates
    expect(minContextForJob("code", contextPolicy({ context: { min_context_tokens: 32_768 } }))).toBe(32_768);
  });

  test("formatContext renders capped and uncapped forms", () => {
    expect(formatContext({ windowTokens: 32 * K, source: "probe", cap: 32 * K }, { windowTokens: 256 * K, source: "probe" }))
      .toBe("ctx 32K·capped(256K·probe)");
    expect(formatContext({ windowTokens: 8192, source: "default" })).toBe("ctx 8K·default");
  });
});
