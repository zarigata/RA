import { describe, expect, test } from "bun:test";
import { OllamaClient, pickClientForModel, pickModel } from "../../src/ollama.ts";
import { loadEnv } from "../../src/env.ts";
import { loadRaConfig } from "../../src/config.ts";

const env = loadEnv();
let client: OllamaClient;
let chatModel = "";
let hasOllama = false;
try {
  const cfg0 = loadRaConfig(new URL("../../", import.meta.url).pathname);
  const picked = await pickClientForModel(cfg0.small_model ?? "ollama-lan/qwen3.8:latest", env);
  client = picked.client;
  chatModel = picked.model;
  hasOllama = client.availableModels.length > 0;
} catch {
  hasOllama = false;
}

/** The LAN box can hitch under load — one retry, generous timeout */
async function chatOnce(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
) {
  const model = chatModel;
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await client.nativeChat(model, messages, { timeoutMs: 90_000 });
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

describe.skipIf(!hasOllama)("Ollama local/LAN integration", () => {
  test("lists available models via native API", async () => {
    expect(client.availableModels.length).toBeGreaterThan(0);
    // Prefer the configured small model family on the LAN host when present
    const names = client.availableModels.join(" ");
    const family = (chatModel.split("/").pop() ?? "").split(":")[0]!;
    expect(
      names.includes(family) || /qwen3\.8|gemma|qwen/i.test(names),
    ).toBe(true);
  });

  test("chat completion returns content", async () => {
    const result = await chatOnce([
      { role: "user", content: "Reply with the single word RA and nothing else." },
    ]);
    expect(result.content.length).toBeGreaterThan(0);
  }, 200_000);

  test("chat respects system prompt (role separation)", async () => {
    const result = await chatOnce([
      { role: "system", content: "You always reply with the word BANANA only. No other words." },
      { role: "user", content: "What are you?" },
    ]);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content.toUpperCase()).toMatch(/BANANA/);
  }, 200_000);
});
