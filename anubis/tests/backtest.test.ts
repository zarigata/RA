import { describe, expect, test } from "bun:test";
import { pickOllamaEndpoint, pickModel } from "../src/ollama.ts";
import { loadEnv } from "../src/env.ts";

const env = loadEnv();
let client: Awaited<ReturnType<typeof pickOllamaEndpoint>>;
let hasOllama = false;
try {
  client = await pickOllamaEndpoint(env);
  // These backtests characterize gpt-oss:20b specifically. The gemma localhost
  // fallback cannot stand in for it (too slow for the longer prompts), so only
  // run when the endpoint actually serves gpt-oss:20b.
  hasOllama = client.availableModels.some((m: string) => m.startsWith("gpt-oss:20b"));
  if (hasOllama) {
    // Reachability is not responsiveness: a LAN box can accept the probe and
    // then hang on generation. Only run the backtests when a tiny chat works.
    await client.nativeChat("gpt-oss:20b", [{ role: "user", content: "reply OK" }], {
      timeoutMs: 20_000,
    });
  }
} catch {
  hasOllama = false;
}

describe.skipIf(!hasOllama)("Backtest: local/LAN Ollama", () => {
  const model = () => pickModel("gpt-oss:20b", client.availableModels);

  async function chat(prompt: string) {
    let last: unknown;
    for (let i = 0; i < 2; i++) {
      try {
        return await client.nativeChat(model(), [{ role: "user", content: prompt }], {
          timeoutMs: 90_000,
        });
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  test("gpt-oss:20b performs planning task", async () => {
    const res = await chat("Explain parallel vs sequential agent orchestration in one sentence.");
    expect(res.content.length).toBeGreaterThan(0);
  }, 200_000);

  test("gpt-oss:20b performs summarization", async () => {
    const res = await chat("Summarize: 'RA is a terminal agent'.");
    expect(res.content.length).toBeGreaterThan(0);
  }, 200_000);
});
