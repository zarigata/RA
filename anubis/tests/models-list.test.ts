import { describe, expect, test } from "bun:test";
import { formatRaModels } from "../src/models-list.ts";

describe("formatRaModels", () => {
  test("header always RA models even when probes fail", async () => {
    const s = await formatRaModels(
      { model: "ollama-cloud/glm-5.2", small_model: "ollama-lan/qwen3.8:latest" },
      {
        OLLAMA_LAN_URL: "http://127.0.0.1:1",
        OLLAMA_LOCAL_URL: "http://127.0.0.1:1",
      },
    );
    expect(s.startsWith("RA models")).toBe(true);
    expect(s).toContain("config BIG:");
    expect(s).toContain("qwen3.8");
    expect(s).toContain("glm-5.2");
  });
});
