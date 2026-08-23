import { describe, expect, test } from "bun:test";
import { pickModel, smallOllamaUrls, fallbackChain, runWithFallback, resolveProviderClient } from "../src/ollama.ts";

describe("small Ollama routing", () => {
  test(".251 first, localhost gemma second", () => {
    const urls = smallOllamaUrls({});
    expect(urls[0]).toBe("http://192.168.1.251:11434");
    expect(urls).toContain("http://localhost:11434");
    expect(urls.length).toBe(2);
  });

  test("OLLAMA_LOCAL_URL overrides localhost default", () => {
    const urls = smallOllamaUrls({
      OLLAMA_LAN_URL: "http://192.168.1.251:11434",
      OLLAMA_LOCAL_URL: "http://127.0.0.1:11434",
    });
    expect(urls).toEqual([
      "http://192.168.1.251:11434",
      "http://127.0.0.1:11434",
      "http://localhost:11434",
    ]);
  });

  test("pickModel prefers qwen3.8 over gemma when both present", () => {
    const available = ["gemma:latest", "qwen3.8:latest", "gemma2:2b"];
    expect(pickModel("ollama-lan/qwen3.8:latest", available)).toBe("qwen3.8:latest");
    expect(pickModel("missing", available)).toBe("qwen3.8:latest");
  });

  test("pickModel falls back to gemma when qwen absent", () => {
    const available = ["gemma:latest", "gemma2:2b"];
    expect(pickModel("ollama-lan/qwen3.8:latest", available)).toBe("gemma:latest");
  });
});

describe("fallback chain", () => {
  test("cloud model falls back to LAN then local", () => {
    const chain = fallbackChain("ollama-cloud/glm-5.2");
    expect(chain[0]).toBe("ollama-cloud/glm-5.2");
    expect(chain).toContain("ollama-lan/qwen3.8:latest");
    expect(chain).toContain("ollama/gemma:latest");
  });

  test("small model falls back to LAN, local, then cloud", () => {
    const chain = fallbackChain("ollama-lan/qwen3.8:latest");
    expect(chain[0]).toBe("ollama-lan/qwen3.8:latest");
    expect(chain).toContain("ollama/gemma:latest");
    expect(chain).toContain("ollama-cloud/glm-5.2");
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
          client: { baseURL: "http://192.168.1.251:11434", kind: "local" } as never,
          model: bare,
        };
      },
    );
    expect(result.content).toBe("ok");
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0].ok).toBe(true);
    expect(attempts[0].host).toBe("251");
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
      "ollama-lan": { options: { baseURL: "http://192.168.1.251:11434/v1" } },
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
});
