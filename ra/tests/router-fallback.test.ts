// router-fallback.test.ts — Wave 3a sweep: the agent-loop fallback decision
// tree as pure-function coverage. Primary failure classification (auth vs
// quota vs context-overflow vs cancel vs outage) × chain composition
// (configured chains, same-kind invariant, dedup, primary removal) × quota
// cooldown lifecycle. The auth-error-no-fallback invariant is the security
// property: a bad key must fail loudly, never silently downgrade.

import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModelFallbacks, fallbackChain, isAuthError, isUserCancel, isContextOverflowError } from "../../anubis/src/ollama.ts";
import { isQuotaError, quotaKey, markExhausted, isExhausted, exhaustedUntil, clearExhausted, quotaHealth, formatQuota, DEFAULT_COOLDOWN_MS } from "../../anubis/src/quota.ts";

// ---- error classification truth table ------------------------------------------------------

describe("fallback error classification — the no-fallback invariants", () => {
  const authMsgs = [
    "401 unauthorized", "403 forbidden", "invalid api key",
    "Authentication failed", "401: Unauthorized",
  ];
  // Known near-misses that are NOT auth errors (regex contract, pinned):
  const notAuthMsgs = ["API key invalid" /* no 'invalid api key' substring */, "audience restricted", "api key missing? key=1234"];
  const quotaMsgs = [
    "429 too many requests", "rate limit exceeded", "rate_limit", "rate-limit hit",
    "insufficient quota", "quota exceeded", "billing hard limit reached",
    "payment required", "exceeded your current quota", "insufficient credits",
    "capacity issues", "You exceeded your included credits",
  ];
  const overflowMsgs = [
    "context length exceeded", "maximum context length is 8192 tokens",
    "prompt is too long", "requested tokens exceed context", "input too large",
    "This model's maximum context length is 200000 tokens. However, you requested 250000",
    "context_length_exceeded", "tokens > 8192 maximum",
  ];
  const outageMsgs = [
    "500 Internal Server Error", "502 Bad Gateway", "fetch failed", "ECONNREFUSED",
    "timeout after 30000ms", "404 model not found", "empty response from model",
  ];
  const cancelMsgs = ["Turn cancelled", "This operation was aborted", "turn cancelled by user"];

  test("auth errors never overlap quota/overflow/cancel", () => {
    for (const m of authMsgs) {
      expect(isAuthError(new Error(m))).toBe(true); // ${m}
      expect(isUserCancel(new Error(m))).toBe(false);
    }
    for (const m of notAuthMsgs) expect(isAuthError(new Error(m))).toBe(false); // ${m}
  });

  test("quota errors are never auth errors (distinct failover semantics)", () => {
    for (const m of quotaMsgs) {
      expect(isQuotaError(new Error(m))).toBe(true); // ${m}
      expect(isAuthError(new Error(m))).toBe(false); // 429 ≠ 401: failover, not abort
    }
  });

  test("context overflow is its own class (checkpoint+resume, not failover)", () => {
    for (const m of overflowMsgs) {
      expect(isContextOverflowError(new Error(m))).toBe(true); // ${m}
      expect(isAuthError(new Error(m))).toBe(false);
      expect(isQuotaError(new Error(m))).toBe(false);
    }
  });

  test("outage messages are failover-class: not auth, not overflow, not cancel", () => {
    for (const m of outageMsgs) {
      expect(isAuthError(new Error(m))).toBe(false); // ${m}
      expect(isContextOverflowError(new Error(m))).toBe(false);
      expect(isUserCancel(new Error(m))).toBe(false);
    }
  });

  test("user cancellations detected; never confused with provider errors", () => {
    for (const m of cancelMsgs) {
      expect(isUserCancel(new Error(m))).toBe(true); // ${m}
    }
    for (const m of outageMsgs) expect(isUserCancel(new Error(m))).toBe(false);
  });

  test("non-Error values classify by String() (throwables from deep stacks)", () => {
    expect(isAuthError("401")).toBe(true);
    expect(isQuotaError("429")).toBe(true);
    expect(isUserCancel(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});

// ---- chain composition ---------------------------------------------------------------------

describe("fallback chain composition permutations", () => {
  test("cloud primary: built-in chain is same-kind (cloud only), primary first, deduped", () => {
    const chain = fallbackChain("ollama-cloud/primary-model");
    expect(chain[0]).toBe("ollama-cloud/primary-model");
    for (const m of chain) expect(m.startsWith("ollama-cloud/")).toBe(true);
    expect(new Set(chain).size).toBe(chain.length);
  });

  test("local primary: built-in chain is local-only", () => {
    const chain = fallbackChain("ollama-lan/x");
    expect(chain[0]).toBe("ollama-lan/x");
    for (const m of chain) expect(m.startsWith("ollama-lan/") || m.startsWith("ollama/")).toBe(true);
  });

  test("same-kind invariant: cross-kind candidates are silently skipped, not errors", () => {
    expect(resolveModelFallbacks("ollama-cloud/a", { default: ["ollama-cloud/b", "ollama-lan/local", "ollama/cloud2", "ollama-cloud/c"] }))
      .toEqual(["ollama-cloud/b", "ollama-cloud/c"]);
    expect(resolveModelFallbacks("ollama-lan/a", { default: ["ollama-lan/b", "ollama-cloud/x", "ollama/y"] }))
      .toEqual(["ollama-lan/b", "ollama/y"]);
  });

  test("primary removed by bare-id comparison (prefix variants of the same model)", () => {
    expect(resolveModelFallbacks("ollama-cloud/m", { default: ["ollama-cloud/m", "m", "ollama-cloud/m:tagged"] }))
      .toEqual(["ollama-cloud/m:tagged"]);
  });

  test("lookup order of configured chains: models[prefixed] > models[bare] > default", () => {
    const fb = {
      default: ["ollama-cloud/d"],
      models: {
        "ollama-cloud/x": ["ollama-cloud/pref"],
        "x": ["ollama-cloud/bare"],
      },
    };
    expect(resolveModelFallbacks("ollama-cloud/x", fb)).toEqual(["ollama-cloud/pref"]);
    expect(resolveModelFallbacks("ollama-cloud/y", fb)).toEqual(["ollama-cloud/d"]); // bare x only matches x
  });

  test("empty configured chain → empty candidates (fail loudly upstream, not silently)", () => {
    expect(resolveModelFallbacks("ollama-cloud/x", { default: [] })).toEqual([]);
  });

  test("chain order is preserved exactly as configured (first-wins retry order)", () => {
    expect(resolveModelFallbacks("ollama-cloud/p", { default: ["ollama-cloud/c", "ollama-cloud/a", "ollama-cloud/b"] }))
      .toEqual(["ollama-cloud/c", "ollama-cloud/a", "ollama-cloud/b"]);
  });
});

// ---- quota cooldown lifecycle -----------------------------------------------------------------

describe("quota cooldown lifecycle (RA_QUOTA_PATH isolated)", () => {
  // os.tmpdir(): CI matrix runs on Windows where /tmp does not exist.
  const QUOTA_DIR = mkdtempSync(join(tmpdir(), "ra-quota-"));
  const PATH = join(QUOTA_DIR, `ra-w3a-quota-${process.pid}.json`);
  beforeEach(() => {
    process.env.RA_QUOTA_PATH = PATH;
    clearExhausted("any");
  });

  test("quotaKey: provider-prefixed ids collapse to the provider; bare ids stay", () => {
    expect(quotaKey("codder/claude-opus-5-5")).toBe("codder");
    expect(quotaKey("ollama-lan/qwen3.8:latest")).toBe("ollama-lan");
    expect(quotaKey("bare-model")).toBe("bare-model");
    expect(quotaKey("/weird")).toBe("/weird"); // slash at 0 is not a prefix
  });

  test("mark → exhausted → cooldown expiry → clear (full lifecycle)", () => {
    const now = Date.now();
    markExhausted("prov/x", "429 rate limited", now + 1000);
    expect(isExhausted("prov/x", now + 500)).toBe(true);
    expect(exhaustedUntil("prov/x", now + 500)).toBe(now + 1000);
    // expired → drops out and cleans the store
    expect(isExhausted("prov/x", now + 1001)).toBe(false);
    // re-mark with default cooldown
    markExhausted("prov/x", "again");
    expect(isExhausted("prov/x")).toBe(true);
    clearExhausted("prov/x");
    expect(isExhausted("prov/x")).toBe(false);
  });

  test("default cooldown is 15 minutes", () => {
    expect(DEFAULT_COOLDOWN_MS).toBe(15 * 60_000);
  });

  test("hits accumulate per provider; marks under model ids share the provider key", () => {
    markExhausted("codder/a", "one");
    markExhausted("codder/b", "two");
    const h = quotaHealth().find((x) => x.provider === "codder")!;
    expect(h.hits).toBe(2);
    expect(h.reason).toBe("two"); // latest reason
    clearExhausted("codder");
  });

  test("formatQuota renders healthy vs exhausted states", () => {
    clearExhausted("p1");
    expect(formatQuota()).toContain("all providers healthy");
    markExhausted("p1", "429");
    expect(formatQuota()).toContain("p1 exhausted");
    expect(formatQuota()).toContain("m left");
    clearExhausted("p1");
  });

  test("reason strings are clipped to 160 chars (store hygiene)", () => {
    markExhausted("clip", "x".repeat(500));
    expect(quotaHealth().find((x) => x.provider === "clip")!.reason.length).toBeLessThanOrEqual(160);
    clearExhausted("clip");
  });
});
