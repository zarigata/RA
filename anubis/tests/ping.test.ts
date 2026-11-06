import { describe, expect, test } from "bun:test";
import { formatPings, notableRegex, type PingResult } from "../src/ping.ts";

// RFC 5737 TEST-NET-1 documentation address — never a real host.
const LAN_URL = "http://192.0.2.50:11434";

describe("formatPings", () => {
  test("shows RA ping with ok/fail lines", () => {
    const pings: PingResult[] = [
      { name: "50", url: LAN_URL, ok: true, ms: 12, models: 5, notable: ["qwen3.8:latest"] },
      { name: "local", url: "http://localhost:11434", ok: true, ms: 3, models: 1, notable: ["gemma:latest"] },
      { name: "cloud", url: "https://ollama.com/v1", ok: false, ms: 50, error: "HTTP 401" },
    ];
    const text = formatPings(pings);
    expect(text).toContain("RA ping");
    expect(text).toContain("✓ 50");
    expect(text).toContain(LAN_URL);
    expect(text).toContain("qwen3.8:latest");
    expect(text).toContain("✗ cloud");
    expect(text).toContain("RA prefer small@50 → big@down");
  });

  test("falls back to small@local when the LAN box is down", () => {
    const pings: PingResult[] = [
      { name: "50", url: LAN_URL, ok: false, ms: 11, error: "down" },
      { name: "local", url: "http://localhost:11434", ok: true, ms: 3, models: 1, notable: ["gemma:latest"] },
      { name: "cloud", url: "https://ollama.com/v1", ok: true, ms: 50, models: 19 },
    ];
    const text = formatPings(pings);
    expect(text).toContain("✗ 50");
    expect(text).toContain("✓ local");
    expect(text).toContain("RA prefer small@local → big@cloud");
  });
});

describe("notableRegex", () => {
  test("derives family tokens from configured profile models", () => {
    const re = notableRegex("ollama-lan/qwen3.8:latest", "ollama-cloud/glm-5.2");
    expect(re.test("qwen3.8:latest")).toBe(true);
    expect(re.test("qwen3-coder-30b-a3b-instruct-ud-q4_k_xl:latest")).toBe(false); // family qwen3-coder vs token qwen3.8
    expect(re.test("glm-5.2")).toBe(true);
  });

  test("always matches gemma (documented fallback)", () => {
    const re = notableRegex();
    expect(re.test("gemma:latest")).toBe(true);
    expect(re.test("gemma2:2b")).toBe(true);
    expect(re.test("llama3:8b")).toBe(false);
  });

  test("escapes regex metacharacters in model names", () => {
    const re = notableRegex("ollama-lan/qwen3.8:latest");
    expect(re.source).toContain("qwen3\\.8");
    expect(re.test("qwen3.8:latest")).toBe(true);
    expect(re.test("qwen3x8")).toBe(false);
  });
});
