import { describe, expect, test } from "bun:test";
import { pickOllamaEndpoint, pickModel } from "../src/ollama.ts";
import { loadEnv } from "../src/env.ts";

const env = loadEnv();
let client: Awaited<ReturnType<typeof pickOllamaEndpoint>>;
let hasOllama = false;
try {
  client = await pickOllamaEndpoint(env);
  hasOllama = client.availableModels.length > 0;
} catch {
  hasOllama = false;
}

describe.skipIf(!hasOllama)("Backtest: local/LAN Ollama", () => {
  const model = () => pickModel("qwen3.8:latest", client.availableModels);

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

  test("qwen3.8 performs planning task", async () => {
    const res = await chat("Explain parallel vs sequential agent orchestration in one sentence.");
    expect(res.content.length).toBeGreaterThan(0);
  }, 200_000);

  test("qwen3.8 performs summarization", async () => {
    const res = await chat("Summarize: 'RA is a terminal agent'.");
    expect(res.content.length).toBeGreaterThan(0);
  }, 200_000);
});
