// pricing-permutations.test.ts — Wave 3a property sweep: priceOverridesFromConfig
// × priceFor × the bare-suffix fallback. Full permutation of the 3 config
// shapes (options.pricing / models.cost / top-level pricing), their
// precedence order, bare-suffix matching, and malformed/missing fields
// (pure; skipped, never thrown — fail-closed to $0, never NaN).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  priceOverridesFromConfig, setPriceOverrides, clearPriceOverrides,
  priceFor, estimateCost, isFree, isSubscriptionCovered, tagModel,
  type PricingEntry,
} from "../src/cost.ts";

beforeEach(() => clearPriceOverrides());
afterEach(() => clearPriceOverrides());

describe("priceOverridesFromConfig — shape permutations", () => {
  test("shape 1: provider.<name>.options.pricing applies to EVERY model of the provider", () => {
    const map = priceOverridesFromConfig({
      provider: { codder: { options: { pricing: { input_per_m:  3, output_per_m: 15 } }, models: { "opus": {}, "sonnet": {} } } },
    });
    expect(map["codder/opus"]).toEqual({ in: 3, out: 15 });
    expect(map["codder/sonnet"]).toEqual({ in: 3, out: 15 });
  });

  test("shape 2: models.<id>.cost (opencode schema) overrides the per-provider default", () => {
    const map = priceOverridesFromConfig({
      provider: { codder: {
        options: { pricing: { input_per_m: 3, output_per_m: 15 } },
        models: { opus: { cost: { input: 15, output: 75 } }, sonnet: {} },
      } },
    });
    expect(map["codder/opus"]).toEqual({ in: 15, out: 75 }); // per-model wins
    expect(map["codder/sonnet"]).toEqual({ in: 3, out: 15 });
  });

  test("shape 3: top-level pricing map wins over both provider shapes", () => {
    const map = priceOverridesFromConfig({
      provider: { codder: { options: { pricing: { input_per_m: 3, output_per_m: 15 } }, models: { opus: { cost: { input: 15, output: 75 } } } } },
      pricing: { "codder/opus": { input_per_m: 1, output_per_m: 5 } },
    });
    expect(map["codder/opus"]).toEqual({ in: 1, out: 5 });
  });

  test("precedence summary: pricing > models.cost > options.pricing", () => {
    const cfg = {
      provider: { p: {
        options: { pricing: { input_per_m: 1, output_per_m: 1 } },
        models: { a: { cost: { input: 2, output: 2 } }, b: {}, c: { cost: { input: 3, output: 3 } } },
      } },
      pricing: { "p/a": { input_per_m: 4, output_per_m: 4 } },
    };
    const map = priceOverridesFromConfig(cfg);
    expect(map["p/a"]).toEqual({ in: 4, out: 4 }); // top-level wins
    expect(map["p/b"]).toEqual({ in: 1, out: 1 }); // provider default
    expect(map["p/c"]).toEqual({ in: 3, out: 3 }); // models.cost beats provider default
  });

  test("models listed under a provider with NO pricing blocks yield no entries", () => {
    const map = priceOverridesFromConfig({ provider: { z: { models: { m: {} } } } });
    expect(map["z/m"]).toBeUndefined();
  });

  test("missing fields are skipped, never half-priced (input without output etc.)", () => {
    const map = priceOverridesFromConfig({
      provider: { p: { options: { pricing: { input_per_m: 5 } }, models: { m: {} } } },
      pricing: {
        "a/no-output": { input_per_m: 1 },
        "b/no-input": { output_per_m: 1 },
        "c/negative": { input_per_m: -1, output_per_m: 1 },
        "d/zero-zero": { input_per_m: 0, output_per_m: 0 },
        "e/nan": { input_per_m: Number.NaN, output_per_m: 1 },
        "f/string": { input_per_m: "cheap" as unknown as number, output_per_m: 1 },
        "g/valid": { input_per_m: 2, output_per_m: 2 },
      },
    });
    expect(map["a/no-output"]).toBeUndefined();
    expect(map["b/no-input"]).toBeUndefined();
    expect(map["c/negative"]).toBeUndefined();
    // zero-zero is indistinguishable from free — skipped (existing contract:
    // a real override must price something)
    expect(map["d/zero-zero"]).toBeUndefined();
    expect(map["e/nan"]).toBeUndefined();
    expect(map["f/string"]).toBeUndefined();
    expect(map["g/valid"]).toEqual({ in: 2, out: 2 });
    expect(map["p/m"]).toBeUndefined(); // provider pricing had only input → skipped
  });

  test("null/garbage provider blocks never throw", () => {
    expect(() => priceOverridesFromConfig({
      provider: { nullish: null, num: 5, arr: [], str: "x" } as unknown as Record<string, never>,
    })).not.toThrow();
    const map = priceOverridesFromConfig({
      provider: { nullish: null, num: 5, arr: [], str: "x" } as unknown as Record<string, never>,
    });
    expect(Object.keys(map)).toEqual([]);
  });
});

describe("priceFor — lookup precedence + bare-suffix match", () => {
  test("free prefixes always win ($0) even over an explicit override", () => {
    setPriceOverrides({ "ollama-lan/qwen3.8": { in: 5, out: 5 } });
    expect(priceFor("ollama-lan/qwen3.8")).toEqual({ in: 0, out: 0 });
    expect(priceFor("ollama/x")).toEqual({ in: 0, out: 0 });
    expect(priceFor("lmstudio-lan/x")).toEqual({ in: 0, out: 0 });
    expect(priceFor("llamacpp/x")).toEqual({ in: 0, out: 0 });
  });

  test("static table serves known cloud models without overrides", () => {
    expect(priceFor("anthropic/claude-sonnet-4-5")).toEqual({ in: 3, out: 15 });
    expect(priceFor("claude/claude-opus-4-5")).toEqual({ in: 15, out: 75 });
  });

  test("exact override key wins before suffix scan", () => {
    setPriceOverrides({
      "codder/claude-sonnet-5-5": { in: 1, out: 2 },
      "other/claude-sonnet-5-5": { in: 9, out: 9 },
    });
    expect(priceFor("codder/claude-sonnet-5-5")).toEqual({ in: 1, out: 2 });
  });

  test("bare-suffix fallback: an unregistered provider/<id> still finds */<id> overrides", () => {
    setPriceOverrides({ "codder/claude-opus-5-5": { in: 15, out: 75 } });
    // server reports the bare id → tagged under another provider namespace
    expect(priceFor("ollama-cloud/claude-opus-5-5")).toEqual({ in: 15, out: 75 });
    expect(priceFor("whatever-lane/claude-opus-5-5")).toEqual({ in: 15, out: 75 });
    // the bare id itself matches a bare override key
    setPriceOverrides({ "claude-opus-5-5": { in: 1, out: 1 } });
    expect(priceFor("x/claude-opus-5-5")).toEqual({ in: 1, out: 1 });
  });

  test("unknown model without any override fails closed to $0 (not NaN, not throw)", () => {
    expect(priceFor("mystery/model-x")).toEqual({ in: 0, out: 0 });
    expect(estimateCost("mystery/model-x", 1e6, 1e6)).toBe(0);
  });

  test("estimateCost arithmetic is linear per million", () => {
    setPriceOverrides({ "t/m": { in: 2, out: 10 } });
    expect(estimateCost("t/m", 500_000, 1_000_000)).toBe(1 + 10);
    expect(estimateCost("t/m", 0, 0)).toBe(0);
  });
});

describe("isFree / isSubscriptionCovered / tagModel permutations", () => {
  test("isFree across every free prefix and non-free lookalikes", () => {
    for (const p of ["ollama/", "ollama-lan/", "lmstudio/", "lmstudio-lan/", "llamacpp/", "llamacpp-lan/"]) {
      expect(isFree(`${p}m`)).toBe(true); // ${p}
    }
    expect(isFree("ollama-cloud/glm-5.2")).toBe(false);
    expect(isFree("codder/opus")).toBe(false);
    expect(isFree("bare")).toBe(false);
    expect(isFree("")).toBe(false);
  });

  test("isSubscriptionCovered: only ollama-cloud models priced at zero", () => {
    expect(isSubscriptionCovered("ollama-cloud/glm-5.2")).toBe(true);
    expect(isSubscriptionCovered("ollama-lan/qwen3.8")).toBe(false); // local ≠ subscription
    // an explicitly-priced ollama-cloud model is billed, not subscription
    setPriceOverrides({ "ollama-cloud/glm-5.2": { in: 1, out: 1 } });
    expect(isSubscriptionCovered("ollama-cloud/glm-5.2")).toBe(false);
  });

  test("tagModel: bare ids tagged, prefixed ids untouched", () => {
    expect(tagModel("glm-5.2", true)).toBe("ollama-cloud/glm-5.2");
    expect(tagModel("glm-5.2", false)).toBe("ollama-lan/glm-5.2");
    expect(tagModel("codder/opus", true)).toBe("codder/opus");
    expect(tagModel("codder/opus", false)).toBe("codder/opus");
  });
});

describe("pricing sweep — config shape × model lookup end-to-end", () => {
  // The composition contract: overridesFromConfig feeds setPriceOverrides,
  // then every configured lane resolves to a finite price.
  const configs = [
    { name: "empty config", cfg: {} },
    { name: "provider default only", cfg: { provider: { c: { options: { pricing: { input_per_m: 1, output_per_m: 2 } }, models: { a: {}, b: {} } } } } },
    { name: "mixed all three shapes", cfg: {
      provider: { c: { options: { pricing: { input_per_m: 1, output_per_m: 1 } }, models: { a: { cost: { input: 2, output: 2 } }, b: {} } } },
      pricing: { "c/a": { input_per_m: 3, output_per_m: 3 } },
    } },
    { name: "malformed everything", cfg: {
      provider: { c: { options: { pricing: { input_per_m: "x" } }, models: { a: { cost: { input: null } } } } },
      pricing: { "c/a": null as unknown as PricingEntry, "c/b": undefined as unknown as PricingEntry },
    } },
  ];

  for (const { name, cfg } of configs) {
    test(`${name}: every lane price is finite and non-negative`, () => {
      clearPriceOverrides();
      setPriceOverrides(priceOverridesFromConfig(cfg as Parameters<typeof priceOverridesFromConfig>[0]));
      for (const lane of ["c/a", "c/b", "c/missing", "ollama-lan/qwen3.8", "anthropic/claude-sonnet-4-5"]) {
        const p = priceFor(lane);
        expect(Number.isFinite(p.in)).toBe(true); // ${name} ${lane}
        expect(Number.isFinite(p.out)).toBe(true);
        expect(p.in).toBeGreaterThanOrEqual(0);
        expect(p.out).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(estimateCost(lane, 12345, 6789))).toBe(false);
      }
    });
  }
});
