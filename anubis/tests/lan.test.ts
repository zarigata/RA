import { describe, expect, test } from "bun:test";
import {
  expandSubnet,
  scanHost,
  buildLanConfig,
  formatDiscovery,
  type DiscoveredHost,
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
      { host: "192.168.1.60", port: 1234, provider: "lmstudio-lan", name: "LM Studio", models: ["qwen"] },
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
