import { describe, expect, test } from "bun:test";
import { formatLanes } from "../src/lanes.ts";

describe("RA lanes", () => {
  test("shows RA branding and .251 / cloud / gemma fallback", () => {
    const s = formatLanes(
      { model: "ollama-cloud/glm-5.2", small_model: "ollama-lan/qwen3.8:latest" },
      {
        OLLAMA_LAN_URL: "http://192.168.1.251:11434",
        OLLAMA_LOCAL_URL: "http://localhost:11434",
      },
    );
    expect(s.startsWith("RA lanes")).toBe(true);
    expect(s).toContain("qwen3.8");
    expect(s).toContain("192.168.1.251");
    expect(s).toContain("@251");
    expect(s).toContain("gemma");
    expect(s).toContain("@local");
    expect(s).toContain("glm-5.2");
    expect(s).toContain("@cloud");
  });
});
