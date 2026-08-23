import { describe, expect, test } from "bun:test";
import { toProviderDef, buildProviderConfig, countUsableProviders, type Catalog } from "../src/catalog.ts";

const sample: Catalog = {
  "hpc-ai": {
    id: "hpc-ai",
    name: "HPC-AI",
    api: "https://api.hpc-ai.com/inference/v1",
    env: ["HPC_AI_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    models: {
      "deepseek/deepseek-v4-flash": { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    },
  },
  "no-api": {
    id: "no-api",
    name: "No API",
    env: ["SOME_KEY"],
    models: {},
  },
  "no-env": {
    id: "no-env",
    name: "No Env",
    api: "https://example.com/v1",
    models: {},
  },
};

describe("models.dev catalog", () => {
  test("toProviderDef converts an OpenAI-compatible provider", () => {
    const def = toProviderDef(sample["hpc-ai"]);
    expect(def).not.toBeNull();
    expect(def!.options.baseURL).toBe("https://api.hpc-ai.com/inference/v1");
    expect(def!.options.apiKey).toBe("{env:HPC_AI_API_KEY}");
    expect(def!.models["deepseek/deepseek-v4-flash"].name).toBe("DeepSeek V4 Flash");
  });

  test("toProviderDef returns null without api or env", () => {
    expect(toProviderDef(sample["no-api"])).toBeNull();
    expect(toProviderDef(sample["no-env"])).toBeNull();
  });

  test("buildProviderConfig only includes usable providers", () => {
    const cfg = buildProviderConfig(sample);
    expect(Object.keys(cfg)).toEqual(["hpc-ai"]);
  });

  test("countUsableProviders counts api+env providers", () => {
    expect(countUsableProviders(sample)).toBe(1);
  });
});
