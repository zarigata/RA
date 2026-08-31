import { describe, expect, test } from "bun:test";
import { fallbackChain, resolveModelFallbacks, isAuthError, isUserCancel } from "../../anubis/src/ollama.ts";
import type { ModelFallbacks } from "../../anubis/src/ollama.ts";

describe("resolveModelFallbacks", () => {
  test("cloud primary with no config uses built-in cloud chain (never local)", () => {
    const chain = resolveModelFallbacks("ollama-cloud/deepseek-v4-pro:0813");
    expect(chain.length).toBeGreaterThan(0);
    for (const m of chain) expect(m).not.toMatch(/qwen|gemma/);
  });

  test("local primary never receives cloud candidates", () => {
    const chain = resolveModelFallbacks("ollama-lan/qwen3.8:latest", { default: ["ollama-cloud/gpt-oss:120b", "ollama/gemma:latest"] });
    expect(chain).toEqual(["gemma:latest"]);
  });

  test("per-model config wins over default chain", () => {
    const cfg: ModelFallbacks = {
      default: ["ollama-cloud/gpt-oss:120b"],
      models: { "ollama-cloud/deepseek-v4-pro:0813": ["ollama-cloud/kimi-k2.7-code", "ollama-cloud/gpt-oss:120b"] },
    };
    expect(resolveModelFallbacks("ollama-cloud/deepseek-v4-pro:0813", cfg)).toEqual(["kimi-k2.7-code", "gpt-oss:120b"]);
  });

  test("bare model key matches prefixed configuration", () => {
    const cfg: ModelFallbacks = { models: { "deepseek-v4-pro:0813": ["ollama-cloud/gpt-oss:120b"] } };
    expect(resolveModelFallbacks("ollama-cloud/deepseek-v4-pro:0813", cfg)).toEqual(["gpt-oss:120b"]);
  });

  test("primary is removed and duplicates are dropped", () => {
    const cfg: ModelFallbacks = { models: { "ollama-cloud/m": ["ollama-cloud/m", "ollama-cloud/a", "ollama-cloud/a"] } };
    expect(resolveModelFallbacks("ollama-cloud/m", cfg)).toEqual(["a"]);
  });

  test("prefixed entries are reduced to bare names", () => {
    const chain = fallbackChain("ollama-cloud/xyz");
    expect(chain[0]).toBe("ollama-cloud/xyz");
    for (const m of chain.slice(1)) expect(m.startsWith("ollama-cloud/")).toBe(true);
  });
});

describe("fallback error classification", () => {
  test("auth errors are detected", () => {
    expect(isAuthError(new Error("nativeChatStream 401: invalid api key"))).toBe(true);
    expect(isAuthError(new Error("nativeChatStream 403: forbidden"))).toBe(true);
    expect(isAuthError(new Error("authentication required"))).toBe(true);
  });

  test("provider errors are not auth errors", () => {
    expect(isAuthError(new Error("nativeChatStream 500: Internal Server Error"))).toBe(false);
    expect(isAuthError(new Error("nativeChatStream 404: model not found"))).toBe(false);
    expect(isAuthError(new Error("nativeChatStream timeout after 30000ms"))).toBe(false);
  });

  test("user cancellation is detected", () => {
    expect(isUserCancel(new Error("Turn cancelled"))).toBe(true);
    expect(isUserCancel(new Error("This operation was aborted"))).toBe(true);
    expect(isUserCancel(new Error("nativeChatStream 500: Internal Server Error"))).toBe(false);
  });
});
