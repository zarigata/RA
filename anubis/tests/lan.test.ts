import { describe, expect, test } from "bun:test";
import {
  expandSubnet,
  scanHost,
  scanSubnetBounded,
  buildLanConfig,
  formatDiscovery,
  type DiscoveredHost,
  type ScanProgress,
} from "../src/lan.ts";

describe("lan subnet expansion", () => {
  test("expands /24 to 254 hosts", () => {
    const hosts = expandSubnet("192.168.1.0/24");
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe("192.168.1.1");
    expect(hosts[253]).toBe("192.168.1.254");
  });
  test("non-/24 returns fallback", () => {
    const hosts = expandSubnet("10.0.0.0/16");
    expect(hosts.length).toBeGreaterThan(0);
  });
  test("invalid cidr returns empty/fallback", () => {
    expect(expandSubnet("garbage")).toEqual([]);
  });
});

describe("lan scanHost", () => {
  test("returns null for closed port", async () => {
    const result = await scanHost("127.0.0.1", 1, 300);
    expect(result).toBeNull();
  });
  test("returns null for unreachable host", async () => {
    const result = await scanHost("192.0.2.99", 11434, 300); // TEST-NET, unreachable
    expect(result).toBeNull();
  });
});

describe("lan config builder", () => {
  test("buildLanConfig maps hosts to providers", () => {
    const found: DiscoveredHost[] = [
      { host: "192.168.1.50", port: 11434, provider: "ollama-lan", name: "Ollama", models: ["gemma"] },
      { host: "192.168.1.60", port: 1234, provider: "lmstudio-lan", name: "LM Studio", models: ["gpt-oss"] },
    ];
    const cfg = buildLanConfig(found);
    expect(cfg.providers["ollama-lan"].baseURL).toBe("http://192.168.1.50:11434/v1");
    expect(cfg.providers["ollama-lan"].models).toEqual(["gemma"]);
    expect(cfg.providers["lmstudio-lan"].baseURL).toBe("http://192.168.1.60:1234/v1");
  });
  test("formatDiscovery reports found hosts", () => {
    const text = formatDiscovery([
      { host: "1.2.3.4", port: 11434, provider: "ollama-lan", name: "Ollama", models: ["gemma"] },
    ]);
    expect(text).toContain("Ollama");
    expect(text).toContain("gemma");
  });
  test("formatDiscovery empty", () => {
    expect(formatDiscovery([])).toContain("No LAN");
  });
});

describe("scanSubnetBounded", () => {
  /** Fake scanner: instant, .50 hosts have Ollama models, others return null. */
  const fakeScan = async (host: string, port: number): Promise<string[] | null> => {
    if (port !== 11434) return null;
    return host.endsWith(".50") || host.endsWith(".51") ? ["qwen3:4b"] : null;
  };

  test("returns found hosts in first-found order with progress callbacks", async () => {
    const progress: ScanProgress[] = [];
    const found = await scanSubnetBounded("192.168.1.0/24", {
      concurrency: 32,
      scanFn: fakeScan,
      onProgress: (p) => progress.push({ ...p }),
    });
    expect(found.map((h) => h.host)).toEqual(["192.168.1.50", "192.168.1.51"]);
    expect(found[0]).toMatchObject({ port: 11434, provider: "ollama-lan", name: "Ollama", models: ["qwen3:4b"] });
    // progress reaches the full /24 and reports found counts
    const last = progress[progress.length - 1]!;
    expect(last.total).toBe(254);
    expect(last.probed).toBe(254);
    expect(last.found).toBe(2);
    expect(progress.length).toBeGreaterThanOrEqual(254 / 32);
  });

  test("respects the concurrency limit (max in-flight probes)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const scan = async (host: string, port: number): Promise<string[] | null> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return host.endsWith(".50") && port === 11434 ? ["gemma"] : null;
    };
    const found = await scanSubnetBounded("192.168.1.0/24", { concurrency: 8, scanFn: scan });
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(found).toHaveLength(1);
  });

  test("AbortSignal cancels at the next batch and keeps partial results", async () => {
    const controller = new AbortController();
    let calls = 0;
    const scan = async (host: string, port: number): Promise<string[]> => {
      calls++;
      if (host === "192.168.1.1" && port === 11434) controller.abort();
      await new Promise((r) => setTimeout(r, 2));
      return host.endsWith(".50") && port === 11434 ? ["gemma"] : null;
    };
    const found = await scanSubnetBounded("192.168.1.0/24", { concurrency: 4, scanFn: scan, signal: controller.signal });
    expect(calls).toBeLessThan(254 * 3);
    // .50 lives in a later batch than the first — a cancelled scan may be partial (0 or 1)
    expect(found.length).toBeLessThanOrEqual(1);
  });

  test("invalid CIDR throws", async () => {
    await expect(scanSubnetBounded("garbage")).rejects.toThrow(/CIDR/);
  });
});
