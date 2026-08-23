import { describe, expect, test } from "bun:test";
import { formatPings, type PingResult } from "../src/ping.ts";

describe("formatPings", () => {
  test("shows RA ping with ok/fail lines", () => {
    const pings: PingResult[] = [
      { name: "251", url: "http://192.168.1.251:11434", ok: true, ms: 12, models: 5, notable: ["qwen3.8:latest"] },
      { name: "local", url: "http://localhost:11434", ok: true, ms: 3, models: 1, notable: ["gemma:latest"] },
      { name: "cloud", url: "https://ollama.com/v1", ok: false, ms: 50, error: "HTTP 401" },
    ];
    const text = formatPings(pings);
    expect(text).toContain("RA ping");
    expect(text).toContain("✓ 251");
    expect(text).toContain("192.168.1.251");
    expect(text).toContain("qwen3.8:latest");
    expect(text).toContain("✗ cloud");
    expect(text).toContain("RA prefer small@251 → big@down");
  });
});
