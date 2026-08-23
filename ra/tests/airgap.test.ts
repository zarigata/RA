import { describe, expect, test } from "bun:test";
import { isAirgapped, localizeModel, isLocalUrl } from "../src/airgap.ts";
import type { RaConfig } from "../../anubis/src/config.ts";

const base: RaConfig = { agent: {}, model: "ollama-cloud/glm-5.2" };

describe("air-gapped mode", () => {
  test("isAirgapped via config flag", () => {
    expect(isAirgapped({ ...base, airgap: true }, {})).toBe(true);
    expect(isAirgapped(base, {})).toBe(false);
  });

  test("isAirgapped via env var", () => {
    expect(isAirgapped(base, { RA_AIRGAP: "1" })).toBe(true);
    expect(isAirgapped(base, { RA_AIRGAP: "true" })).toBe(true);
    expect(isAirgapped(base, { RA_AIRGAP: "0" })).toBe(false);
  });

  test("localizeModel replaces cloud models with small", () => {
    expect(localizeModel("ollama-cloud/glm-5.2", "ollama-lan/qwen3.8:latest")).toBe("ollama-lan/qwen3.8:latest");
    expect(localizeModel("zai/glm-5.2", "ollama-lan/qwen3.8:latest")).toBe("ollama-lan/qwen3.8:latest");
    expect(localizeModel("ollama-lan/qwen3.8:latest", "ollama-lan/qwen3.8:latest")).toBe("ollama-lan/qwen3.8:latest");
  });

  test("isLocalUrl detects local/LAN addresses", () => {
    expect(isLocalUrl("localhost:11434")).toBe(true);
    expect(isLocalUrl("192.168.1.251")).toBe(true);
    expect(isLocalUrl("10.0.0.1")).toBe(true);
    expect(isLocalUrl("example.com")).toBe(false);
  });
});
