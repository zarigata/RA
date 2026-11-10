import { describe, expect, test } from "bun:test";
import { pickModel, smallOllamaUrls, fallbackChain, runWithFallback, resolveProviderClient, discoverLocalOpenAI, OllamaClient } from "../src/ollama.ts";

// RFC 5737 TEST-NET-1 documentation address — never a real host.
const LAN_URL = "http://192.0.2.50:11434";

describe("small Ollama routing", () => {
  test("OLLAMA_LAN_URL first, localhost second", () => {
    const urls = smallOllamaUrls({ OLLAMA_LAN_URL: LAN_URL });
    expect(urls[0]).toBe(LAN_URL);
    expect(urls).toContain("http://localhost:11434");
    expect(urls.length).toBe(2);
  });

  test("defaults to localhost when no LAN URL is configured", () => {
    const urls = smallOllamaUrls({});
    expect(urls[0]).toBe("http://localhost:11434");
    expect(urls.length).toBe(1);
  });

  test("OLLAMA_LOCAL_URL overrides localhost default", () => {
    const urls = smallOllamaUrls({
      OLLAMA_LAN_URL: LAN_URL,
      OLLAMA_LOCAL_URL: "http://127.0.0.1:11434",
    });
    expect(urls).toEqual([
      LAN_URL,
      "http://127.0.0.1:11434",
      "http://localhost:11434",
    ]);
  });

  test("RA_LOCAL_ONLY=1 drops the hardcoded localhost fallback", () => {
    // Wave 2 isolation: a harness pointing OLLAMA_LAN_URL at its shim must
    // never silently fall back to a real localhost ollama on this Mac.
    const urls = smallOllamaUrls({ OLLAMA_LAN_URL: "http://localhost:20123", RA_LOCAL_ONLY: "1" });
    expect(urls).toEqual(["http://localhost:20123"]);
  });

  test("pickModel prefers the configured family when present", () => {
    const available = ["gemma:latest", "qwen3.8:latest", "gemma2:2b"];
    expect(pickModel("ollama-lan/qwen3.8:latest", available)).toBe("qwen3.8:latest");
    expect(pickModel("missing", available)).toBe("qwen3.8:latest");
  });

  test("pickModel falls back to gemma when the configured family is absent", () => {
    const available = ["gemma:latest", "gemma2:2b"];
    expect(pickModel("ollama-lan/qwen3.8:latest", available)).toBe("gemma:latest");
  });
});

describe("fallback chain", () => {
  test("cloud model falls back only to other cloud models", () => {
    const chain = fallbackChain("ollama-cloud/glm-5.2");
    expect(chain[0]).toBe("ollama-cloud/glm-5.2");
    for (const m of chain.slice(1)) {
      expect(m.startsWith("ollama-cloud/")).toBe(true);
    }
    expect(chain).not.toContain("ollama-lan/qwen3.8:latest");
    expect(chain).not.toContain("ollama/gemma:latest");
  });

  test("small model falls back only to other local models", () => {
    const chain = fallbackChain("ollama-lan/qwen3.8:latest");
    expect(chain[0]).toBe("ollama-lan/qwen3.8:latest");
    expect(chain).toContain("ollama/gemma:latest");
    expect(chain.every((m) => !m.startsWith("ollama-cloud/"))).toBe(true);
  });

  test("dedupes repeated candidates", () => {
    const chain = fallbackChain("ollama-lan/qwen3.8:latest");
    expect(new Set(chain).size).toBe(chain.length);
  });

  test("runWithFallback returns first success and records attempts", async () => {
    const calls: string[] = [];
    const { result, attempts } = await runWithFallback(
      "ollama-lan/qwen3.8:latest",
      {},
      async (_client, model) => {
        calls.push(model);
        if (model === "qwen3.8:latest") {
          return { content: "ok", model, usage: null };
        }
        throw new Error("down");
      },
      async (candidate) => {
        // Fake picker: resolve candidate to a bare model + a fake client.
        const bare = candidate.split("/").pop()!;
        return {
          client: { baseURL: LAN_URL, kind: "local" } as never,
          model: bare,
        };
      },
    );
    expect(result.content).toBe("ok");
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0].ok).toBe(true);
    expect(attempts[0].host).toBe("50");
  });

  test("runWithFallback throws when all candidates fail", async () => {
    await expect(
      runWithFallback(
        "ollama-lan/qwen3.8:latest",
        {},
        async () => {
          throw new Error("down");
        },
        async (candidate) => ({
          client: { baseURL: "http://localhost:11434", kind: "local" } as never,
          model: candidate.split("/").pop()!,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("provider abstraction", () => {
  test("resolveProviderClient resolves a configured provider with env key", () => {
    const client = resolveProviderClient(
      "zai/glm-5.2",
      {
        zai: { options: { baseURL: "https://api.z.ai/v1", apiKey: "{env:ZAI_API_KEY}" } },
      },
      { ZAI_API_KEY: "secret-key" },
    );
    expect(client).not.toBeNull();
    expect(client!.baseURL).toBe("https://api.z.ai/v1");
    expect(client!.kind).toBe("cloud");
  });

  test("resolveProviderClient expands {env:VAR} in baseURL", () => {
    const client = resolveProviderClient(
      "custom/model",
      { custom: { options: { baseURL: "{env:CUSTOM_URL}/v1" } } },
      { CUSTOM_URL: "https://api.example.com" },
    );
    expect(client).not.toBeNull();
    expect(client!.baseURL).toBe("https://api.example.com/v1");
  });

  test("resolveProviderClient returns null when the baseURL env var is unset", () => {
    const client = resolveProviderClient(
      "custom/model",
      { custom: { options: { baseURL: "{env:CUSTOM_URL}/v1" } } },
      {},
    );
    expect(client).toBeNull();
  });

  test("resolveProviderClient returns null for unconfigured provider", () => {
    expect(resolveProviderClient("unknown/model", undefined, {})).toBeNull();
    expect(resolveProviderClient("zai/glm-5.2", {}, {})).toBeNull();
  });

  test("resolveProviderClient returns null for bare model (no slash)", () => {
    expect(resolveProviderClient("qwen3.8:latest", {}, {})).toBeNull();
  });

  test("resolveProviderClient skips built-in ollama providers", () => {
    const providers = {
      ollama: { options: { baseURL: "http://localhost:11434/v1" } },
      "ollama-lan": { options: { baseURL: LAN_URL + "/v1" } },
    };
    expect(resolveProviderClient("ollama/gemma:latest", providers, {})).toBeNull();
    expect(resolveProviderClient("ollama-lan/qwen3.8:latest", providers, {})).toBeNull();
  });

  test("resolveProviderClient infers local kind from localhost baseURL", () => {
    const client = resolveProviderClient(
      "lmstudio/model",
      { lmstudio: { options: { baseURL: "http://localhost:1234/v1" } } },
      {},
    );
    expect(client).not.toBeNull();
    expect(client!.kind).toBe("local");
  });

  test("fromOpenAI uses OpenAI-compatible chat and local kind", () => {
    const c = OllamaClient.fromOpenAI("http://localhost:1234");
    expect(c.kind).toBe("local");
    expect(c.baseURL).toBe("http://localhost:1234/v1");
  });

  test("discoverLocalOpenAI returns null when nothing reachable", async () => {
    // Use an unreachable port to avoid network flakiness.
    const c = await discoverLocalOpenAI({}, ["http://localhost:1"]);
    expect(c).toBeNull();
  });
});
